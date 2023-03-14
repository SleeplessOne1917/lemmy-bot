import { connection as Connection, client as WebsocketClient } from 'websocket';
import { v4 as uuidv4 } from 'uuid';

import {
  GetPostsResponse,
  LoginResponse,
  PrivateMessagesResponse,
  GetCommentsResponse,
  ListRegistrationApplicationsResponse,
  GetPersonMentionsResponse,
  GetRepliesResponse,
  ListCommentReportsResponse,
  ListPostReportsResponse,
  ListPrivateMessageReportsResponse,
  PostFeatureType,
  GetModlogResponse,
  PostView,
  CommentView,
  SearchType,
  SearchResponse
} from 'lemmy-js-client';
import {
  BotConnectionOptions,
  BotCredentials,
  BotFederationOptions,
  BotTask,
  correctVote,
  extractInstanceFromActorId,
  getInsecureWebsocketUrl,
  getInstanceRegex,
  getListingType,
  getSecureWebsocketUrl,
  HandlerOptions,
  Handlers,
  InstanceFederationOptions,
  InternalSearchOptions,
  parseHandlers,
  SearchOptions,
  shouldProcess,
  Vote
} from './helpers';
import {
  createApplicationApproval,
  createBanFromCommunity,
  createBanFromSite,
  createComment,
  createCommentReport,
  createFeaturePost,
  createLockPost,
  createPostReport,
  createPrivateMessage,
  createPrivateMessageReport,
  createRemoveComment,
  createRemovePost,
  createResolveCommentReport,
  createResolvePostReport,
  createResolvePrivateMessageReport,
  createSearch,
  enableBotAccount,
  getAddedAdmins,
  getBansFromCommunities,
  getBansFromSite,
  getCommentReports,
  getComments,
  getFeaturedPosts,
  getLockedPosts,
  getMentions,
  getModsAddedToCommunities,
  getModsTransferringCommunities,
  getPostReports,
  getPosts,
  getPrivateMessageReports,
  getPrivateMessages,
  getRegistrationApplications,
  getRemovedComments,
  getRemovedCommunities,
  getRemovedPosts,
  getReplies,
  logIn,
  markMentionAsRead,
  markPrivateMessageAsRead,
  markReplyAsRead,
  voteDBComment,
  voteDBPost
} from './actions';
import {
  RowUpserter,
  setupDB,
  StorageInfoGetter,
  useDatabaseFunctions
} from './db';
import { getReprocessFunctions } from './reprocessHandler';
import cron, { ScheduledTask } from 'node-cron';

const DEFAULT_SECONDS_BETWEEN_POLLS = 10;
const DEFAULT_MINUTES_BEFORE_RETRY_CONNECTION = 5;
const DEFAULT_MINUTES_UNTIL_REPROCESS: number | undefined = undefined;

type LemmyBotOptions = {
  credentials?: BotCredentials;
  instance: string;
  connection?: BotConnectionOptions;
  handlers?: Handlers;
  federation?: 'local' | 'all' | BotFederationOptions;
  schedule?: BotTask | BotTask[];
};

export type BotActions = {
  replyToComment: (options: {
    commentId: number;
    postId: number;
    content: string;
  }) => void;
  reportComment: (commentId: number, reason: string) => void;
  replyToPost: (postId: number, content: string) => void;
  reportPost: (postId: number, reason: string) => void;
  votePost: (postId: number, vote: Vote) => void;
  voteComment: (commentId: number, vote: Vote) => void;
  banFromCommunity: (options: {
    communityId: number;
    personId: number;
    daysUntilExpires?: number;
    reason?: string;
    removeData?: boolean;
  }) => void;
  banFromSite: (options: {
    personId: number;
    daysUntilExpires?: number;
    reason?: string;
    removeData?: boolean;
  }) => void;
  sendPrivateMessage: (recipientId: number, content: string) => void;
  reportPrivateMessage: (messageId: number, reason: string) => void;
  approveRegistrationApplication: (applicationId: number) => void;
  rejectRegistrationApplication: (
    applicationId: number,
    denyReason?: string
  ) => void;
  removePost: (postId: number, reason?: string) => void;
  removeComment: (commentId: number, reason?: string) => void;
  resolvePostReport: (postReportId: number) => void;
  resolveCommentReport: (commentReportId: number) => void;
  resolvePrivateMessageReport: (privateMessageReportId: number) => void;
  featurePost: (options: {
    postId: number;
    featureType: PostFeatureType;
    featured: boolean;
  }) => void;
  lockPost: (postId: number, locked: boolean) => void;
  getCommunityId: (options: SearchOptions) => Promise<number | null>;
  getUserId: (options: SearchOptions) => Promise<number | null>;
};

const client = new WebsocketClient();

export class LemmyBot {
  #instance: string;
  #username?: string;
  #password?: string;
  #connection?: Connection = undefined;
  #forcingClosed = false;
  #timeouts: NodeJS.Timeout[] = [];
  #auth?: string;
  #isSecureConnection = true;
  #defaultMinutesUntilReprocess?: number;
  #federationOptions: BotFederationOptions;
  #tasks: ScheduledTask[] = [];
  #delayedTasks: (() => Promise<void>)[] = [];
  #unfinishedSearchMap: Map<string, InternalSearchOptions> = new Map();
  #finishedSearchMap: Map<string, number | null> = new Map();
  #botActions: BotActions = {
    replyToPost: (postId, content) => {
      if (this.#connection && this.#auth) {
        console.log(`Replying to post ID ${postId}`);
        createComment({
          connection: this.#connection,
          auth: this.#auth,
          content,
          postId: postId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to post comment'
            : 'Must log in to post comment'
        );
      }
    },
    reportPost: (postId, reason) => {
      if (this.#connection && this.#auth) {
        console.log(`Reporting to post ID ${postId} for ${reason}`);
        createPostReport({
          auth: this.#auth,
          connection: this.#connection,
          id: postId,
          reason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to report post'
            : 'Must log in to report post'
        );
      }
    },
    votePost: (postId, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      if (this.#connection && this.#auth) {
        console.log(`${prefix}voting post ID ${postId}`);
        voteDBPost({
          connection: this.#connection,
          auth: this.#auth,
          id: postId,
          vote
        });
      } else {
        console.log(
          !this.#connection
            ? `Must be connected to ${prefix.toLowerCase()}vote post`
            : `Must log in to ${prefix.toLowerCase()}vote post`
        );
      }
    },
    replyToComment: ({ commentId, content, postId }) => {
      if (this.#connection && this.#auth) {
        console.log(`Replying to comment ID ${commentId}`);
        createComment({
          connection: this.#connection,
          auth: this.#auth,
          content,
          postId: postId,
          parentId: commentId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to post comment'
            : 'Must log in to post comment'
        );
      }
    },
    reportComment: (commentId, reason) => {
      if (this.#connection && this.#auth) {
        console.log(`Reporting to comment ID ${commentId} for ${reason}`);
        createCommentReport({
          auth: this.#auth,
          connection: this.#connection,
          id: commentId,
          reason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to report comment'
            : 'Must log in to report comment'
        );
      }
    },
    voteComment: (commentId, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      if (this.#connection && this.#auth) {
        console.log(`${prefix}voting comment ID ${commentId}`);
        voteDBComment({
          connection: this.#connection,
          auth: this.#auth,
          id: commentId,
          vote
        });
      } else {
        console.log(
          !this.#connection
            ? `Must be connected to ${prefix.toLowerCase()}vote comment`
            : `Must log in to ${prefix.toLowerCase()}vote comment`
        );
      }
    },
    banFromCommunity: (options) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Banning user ID ${options.personId} from ${options.communityId}`
        );
        createBanFromCommunity({
          ...options,
          auth: this.#auth,
          connection: this.#connection
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to ban user'
            : 'Must log in to ban user'
        );
      }
    },
    banFromSite: (options) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Banning user ID ${options.personId} from ${this.#instance}`
        );
        createBanFromSite({
          ...options,
          auth: this.#auth,
          connection: this.#connection
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to ban user'
            : 'Must log in to ban user'
        );
      }
    },
    sendPrivateMessage: (recipientId, content) => {
      if (this.#connection && this.#auth) {
        createPrivateMessage({
          auth: this.#auth,
          connection: this.#connection,
          content,
          recipientId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to send message'
            : 'Must log in to send message'
        );
      }
    },
    reportPrivateMessage: (messageId, reason) => {
      if (this.#connection && this.#auth) {
        createPrivateMessageReport({
          auth: this.#auth,
          connection: this.#connection,
          id: messageId,
          reason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to report message'
            : 'Must log in to report message'
        );
      }
    },
    approveRegistrationApplication: (applicationId) => {
      if (this.#connection && this.#auth) {
        console.log(`Approving application ID ${applicationId}`);
        createApplicationApproval({
          auth: this.#auth,
          connection: this.#connection,
          approve: true,
          id: applicationId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to approve application'
            : 'Must log in to approve application'
        );
      }
    },
    rejectRegistrationApplication: (applicationId, denyReason) => {
      if (this.#connection && this.#auth) {
        console.log(`Rejecting application ID ${applicationId}`);
        createApplicationApproval({
          auth: this.#auth,
          connection: this.#connection,
          approve: false,
          id: applicationId,
          denyReason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to reject application'
            : 'Must log in to reject application'
        );
      }
    },
    removePost: (postId, reason) => {
      if (this.#connection && this.#auth) {
        console.log(`Removing post ID ${postId}`);
        createRemovePost({
          auth: this.#auth,
          connection: this.#connection,
          id: postId,
          removed: true,
          reason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to remove post'
            : 'Must log in to remove post'
        );
      }
    },
    removeComment: (commentId, reason) => {
      if (this.#connection && this.#auth) {
        console.log(`Removing comment ID ${commentId}`);
        createRemoveComment({
          auth: this.#auth,
          connection: this.#connection,
          id: commentId,
          removed: true,
          reason
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to remove comment'
            : 'Must log in to remove comment'
        );
      }
    },
    resolvePostReport: (postReportId) => {
      if (this.#connection && this.#auth) {
        console.log(`Resolving post report ID ${postReportId}`);
        createResolvePostReport({
          auth: this.#auth,
          connection: this.#connection,
          id: postReportId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to resolve post report'
            : 'Must log in to resolve post report'
        );
      }
    },
    resolveCommentReport: (commentReportId) => {
      if (this.#connection && this.#auth) {
        console.log(`Resolving comment report ID ${commentReportId}`);
        createResolveCommentReport({
          auth: this.#auth,
          connection: this.#connection,
          id: commentReportId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to resolve comment report'
            : 'Must log in to resolve comment report'
        );
      }
    },
    resolvePrivateMessageReport: (privateMessageReportId) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Resolving private message report ID ${privateMessageReportId}`
        );
        createResolvePrivateMessageReport({
          auth: this.#auth,
          connection: this.#connection,
          id: privateMessageReportId
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to resolve comment report'
            : 'Must log in to resolve comment report'
        );
      }
    },
    featurePost: ({ featureType, featured, postId }) => {
      if (this.#connection && this.#auth) {
        console.log(`${featured ? 'F' : 'Unf'}eaturing report ID ${postId}`);
        createFeaturePost({
          auth: this.#auth,
          connection: this.#connection,
          id: postId,
          featured,
          featureType
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to feature post'
            : 'Must log in to feature post'
        );
      }
    },
    lockPost: (postId, locked) => {
      if (this.#connection && this.#auth) {
        console.log(`${locked ? 'L' : 'Unl'}ocking report ID ${postId}`);
        createLockPost({
          auth: this.#auth,
          connection: this.#connection,
          id: postId,
          locked
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to lock post'
            : 'Must log in to lock post'
        );
      }
    },
    getCommunityId: (options) =>
      this.#getId(options, SearchType.Communities, 'community'),
    getUserId: (options) => this.#getId(options, SearchType.Users, 'user')
  };

  constructor({
    instance,
    credentials,
    handlers,
    connection: {
      handleConnectionError,
      handleConnectionFailed,
      minutesBeforeRetryConnection = DEFAULT_MINUTES_BEFORE_RETRY_CONNECTION,
      minutesUntilReprocess:
        defaultMinutesUntilReprocess = DEFAULT_MINUTES_UNTIL_REPROCESS,
      secondsBetweenPolls:
        defaultSecondsBetweenPolls = DEFAULT_SECONDS_BETWEEN_POLLS
    } = {
      secondsBetweenPolls: DEFAULT_SECONDS_BETWEEN_POLLS,
      minutesBeforeRetryConnection: DEFAULT_MINUTES_BEFORE_RETRY_CONNECTION,
      minutesUntilReprocess: DEFAULT_MINUTES_UNTIL_REPROCESS
    },
    federation,
    schedule
  }: LemmyBotOptions) {
    switch (federation) {
      case undefined:
      case 'local': {
        this.#federationOptions = {
          allowList: [instance]
        };

        break;
      }
      case 'all': {
        this.#federationOptions = {
          blockList: []
        };

        break;
      }

      default: {
        if (
          (federation.allowList?.length ?? 0) > 0 &&
          (federation.blockList?.length ?? 0) > 0
        ) {
          throw 'Cannot have both block list and allow list defined for federation options';
        } else if (
          (!federation.allowList || federation.allowList.length === 0) &&
          (!federation.blockList || federation.blockList.length === 0)
        ) {
          throw 'Neither the block list nor allow list has any instances. To fix this issue, make sure either allow list or block list (not both) has at least one instance.\n\nAlternatively, the you can set the federation property to one of the strings "local" or "all".';
        } else if (federation.blockList?.includes(instance)) {
          throw 'Cannot put bot instance in blocklist unless blocking specific communitiess';
        } else {
          this.#federationOptions = federation;

          if (
            this.#federationOptions.allowList &&
            !this.#federationOptions.allowList.some(
              (i) =>
                i === instance ||
                (i as InstanceFederationOptions).instance === instance
            )
          ) {
            this.#federationOptions.allowList.push(instance);
          }
        }
      }
    }

    if (schedule) {
      const tasks = Array.isArray(schedule) ? schedule : [schedule];

      for (const task of tasks) {
        if (!cron.validate(task.cronExpression)) {
          throw `Schedule has invalid cron expression (${task.cronExpression}). Consult this documentation for valid expressions: https://www.gnu.org/software/mcron/manual/html_node/Crontab-file.html`;
        }

        this.#tasks.push(
          cron.schedule(
            task.cronExpression,
            async () => {
              if (this.#connection?.connected) {
                await task.doTask(this.#botActions);
              } else {
                this.#delayedTasks.push(async () =>
                  task.doTask(this.#botActions)
                );
                client.connect(getSecureWebsocketUrl(instance));
              }
            },
            task.timezone || task.runAtStart
              ? {
                  ...(task.timezone ? { timezone: task.timezone } : {}),
                  ...(task.runAtStart ? { runOnInit: task.runAtStart } : {})
                }
              : undefined
          )
        );
      }
    }

    const { password, username } = credentials ?? {};
    this.#instance = instance;
    this.#username = username;
    this.#password = password;
    this.#defaultMinutesUntilReprocess = defaultMinutesUntilReprocess;

    const {
      comment: commentOptions,
      post: postOptions,
      privateMessage: privateMessageOptions,
      registrationApplication: registrationAppicationOptions,
      mention: mentionOptions,
      reply: replyOptions,
      commentReport: commentReportOptions,
      postReport: postReportOptions,
      privateMessageReport: privateMessageReportOptions,
      modRemovePost: modRemovePostOptions,
      modLockPost: modLockPostOptions,
      modFeaturePost: modFeaturePostOptions,
      modRemoveComment: modRemoveCommentOptions,
      modRemoveCommunity: modRemoveCommunityOptions,
      modBanFromCommunity: modBanFromCommunityOptions,
      modAddModToCommunity: modAddModToCommunityOptions,
      modTransferCommunity: modTransferCommunityOptions,
      modAddAdmin: modAddAdminOptions,
      modBanFromSite: modBanFromSiteOptions
    } = parseHandlers(handlers);

    client.on('connectFailed', (e) => {
      if (!this.#isSecureConnection) {
        console.log('Connection Failed!');

        this.#isSecureConnection = true;

        if (handleConnectionFailed) {
          handleConnectionFailed(e);
        }
      } else {
        this.#isSecureConnection = false;
        client.connect(getInsecureWebsocketUrl(this.#instance));
      }
    });

    client.on('connect', async (connection) => {
      console.log('Connected to Lemmy Instance');
      this.#connection = connection;

      connection.on('error', (error) => {
        console.log('Connection error');
        console.log(`Error was: ${error.message}`);

        if (handleConnectionError) {
          handleConnectionError(error);
        }
      });

      connection.on('close', () => {
        console.log('Closing connection');
      });

      connection.on('message', async (message) => {
        if (message.type === 'utf8') {
          const response = JSON.parse(message.utf8Data);

          if (response.error && response.error === 'not_logged_in') {
            console.log('Not Logged in');
            this.#login();
          } else if (
            response.error &&
            (response.error === 'couldnt_find_that_username_or_email' ||
              response.error === 'password_incorrect')
          ) {
            console.log('Could not log on');

            connection.close();

            process.exit(1);
          } else {
            switch (response.op) {
              case 'Login': {
                console.log('Logging in');
                this.#auth = (response.data as LoginResponse).jwt;
                if (this.#auth) {
                  console.log('Marking account as bot account');
                  enableBotAccount({ connection, auth: this.#auth });
                }
                break;
              }
              case 'GetComments': {
                const comments = this.#filterInstancesFromResponse(
                  (response.data as GetCommentsResponse).comments
                );

                await useDatabaseFunctions(
                  'comments',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      comments.map((commentView) =>
                        this.#handleEntry({
                          getStorageInfo: get,
                          upsert,
                          options: commentOptions!,
                          entry: { commentView },
                          id: commentView.comment.id
                        })
                      )
                    );
                  }
                );
                break;
              }
              case 'GetPosts': {
                const posts = this.#filterInstancesFromResponse(
                  (response.data as GetPostsResponse).posts
                );

                await useDatabaseFunctions('posts', async ({ get, upsert }) => {
                  await Promise.all(
                    posts.map((postView) =>
                      this.#handleEntry({
                        getStorageInfo: get,
                        upsert,
                        entry: { postView },
                        id: postView.post.id,
                        options: postOptions!
                      })
                    )
                  );
                });
                break;
              }
              case 'GetPrivateMessages': {
                const { private_messages } =
                  response.data as PrivateMessagesResponse;
                await useDatabaseFunctions(
                  'messages',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      private_messages.map((messageView) => {
                        const promise = this.#handleEntry({
                          getStorageInfo: get,
                          options: privateMessageOptions!,
                          entry: { messageView },
                          id: messageView.private_message.id,
                          upsert
                        });

                        if (this.#connection && this.#auth) {
                          markPrivateMessageAsRead({
                            auth: this.#auth,
                            connection: this.#connection,
                            id: messageView.private_message.id
                          });

                          console.log(
                            `Marked private message ID ${messageView.private_message.id} from ${messageView.creator.id} as read`
                          );

                          return promise;
                        }
                      })
                    );
                  }
                );
                break;
              }
              case 'ListRegistrationApplications': {
                const { registration_applications } =
                  response.data as ListRegistrationApplicationsResponse;
                await useDatabaseFunctions(
                  'registrations',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      registration_applications.map((applicationView) =>
                        this.#handleEntry({
                          getStorageInfo: get,
                          upsert,
                          entry: { applicationView },
                          id: applicationView.registration_application.id,
                          options: registrationAppicationOptions!
                        })
                      )
                    );
                  }
                );
                break;
              }
              case 'GetPersonMentions': {
                const { mentions } = response.data as GetPersonMentionsResponse;
                await useDatabaseFunctions(
                  'mentions',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      mentions.map((mentionView) => {
                        const promise = this.#handleEntry({
                          entry: { mentionView },
                          options: mentionOptions!,
                          getStorageInfo: get,
                          id: mentionView.person_mention.id,
                          upsert
                        });

                        if (this.#connection && this.#auth) {
                          markMentionAsRead({
                            connection: this.#connection,
                            auth: this.#auth,
                            id: mentionView.person_mention.id
                          });
                        }

                        return promise;
                      })
                    );
                  }
                );
                break;
              }
              case 'GetReplies': {
                const { replies } = response.data as GetRepliesResponse;
                await useDatabaseFunctions(
                  'replies',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      replies.map((replyView) => {
                        const promise = this.#handleEntry({
                          entry: { replyView },
                          options: replyOptions!,
                          getStorageInfo: get,
                          id: replyView.comment_reply.id,
                          upsert
                        });

                        if (this.#connection && this.#auth) {
                          markReplyAsRead({
                            connection: this.#connection,
                            auth: this.#auth,
                            id: replyView.comment_reply.id
                          });
                        }

                        return promise;
                      })
                    );
                  }
                );
                break;
              }
              case 'ListCommentReports': {
                const { comment_reports } =
                  response.data as ListCommentReportsResponse;
                await useDatabaseFunctions(
                  'commentReports',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      comment_reports.map((reportView) =>
                        this.#handleEntry({
                          entry: { reportView },
                          options: commentReportOptions!,
                          getStorageInfo: get,
                          id: reportView.comment_report.id,
                          upsert
                        })
                      )
                    );
                  }
                );
                break;
              }
              case 'ListPostReports': {
                const { post_reports } =
                  response.data as ListPostReportsResponse;
                await useDatabaseFunctions(
                  'postReports',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      post_reports.map((reportView) =>
                        this.#handleEntry({
                          entry: { reportView },
                          options: postReportOptions!,
                          getStorageInfo: get,
                          id: reportView.post_report.id,
                          upsert
                        })
                      )
                    );
                  }
                );
                break;
              }
              case 'ListPrivateMessageReports': {
                const { private_message_reports } =
                  response.data as ListPrivateMessageReportsResponse;
                await useDatabaseFunctions(
                  'messageReports',
                  async ({ get, upsert }) => {
                    await Promise.all(
                      private_message_reports.map((reportView) =>
                        this.#handleEntry({
                          entry: { reportView },
                          options: privateMessageReportOptions!,
                          getStorageInfo: get,
                          id: reportView.private_message_report.id,
                          upsert
                        })
                      )
                    );
                  }
                );
                break;
              }
              case 'GetModlog': {
                const {
                  removed_posts,
                  locked_posts,
                  featured_posts,
                  removed_comments,
                  removed_communities,
                  banned_from_community,
                  added_to_community,
                  transferred_to_community,
                  added,
                  banned
                } = response.data as GetModlogResponse;

                if (modRemovePostOptions && removed_posts.length > 0) {
                  await useDatabaseFunctions(
                    'removedPosts',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        removed_posts.map((removedPostView) =>
                          this.#handleEntry({
                            entry: { removedPostView },
                            options: modRemovePostOptions!,
                            getStorageInfo: get,
                            id: removedPostView.mod_remove_post.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (modLockPostOptions && locked_posts.length > 0) {
                  await useDatabaseFunctions(
                    'lockedPosts',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        locked_posts.map((lockedPostView) =>
                          this.#handleEntry({
                            entry: { lockedPostView },
                            options: modLockPostOptions!,
                            getStorageInfo: get,
                            id: lockedPostView.mod_lock_post.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (modFeaturePostOptions && featured_posts.length > 0) {
                  await useDatabaseFunctions(
                    'featuredPosts',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        featured_posts.map((featuredPostView) =>
                          this.#handleEntry({
                            entry: { featuredPostView },
                            options: modFeaturePostOptions!,
                            getStorageInfo: get,
                            id: featuredPostView.mod_feature_post.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (modRemoveCommentOptions && removed_comments.length > 0) {
                  await useDatabaseFunctions(
                    'removedComments',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        removed_comments.map((removedCommentView) =>
                          this.#handleEntry({
                            entry: { removedCommentView },
                            options: modRemoveCommentOptions!,
                            getStorageInfo: get,
                            id: removedCommentView.mod_remove_comment.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (
                  modRemoveCommunityOptions &&
                  removed_communities.length > 0
                ) {
                  await useDatabaseFunctions(
                    'removedCommunities',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        removed_communities.map((removedCommunityView) =>
                          this.#handleEntry({
                            entry: { removedCommunityView },
                            options: modRemoveCommunityOptions!,
                            getStorageInfo: get,
                            id: removedCommunityView.mod_remove_community.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (
                  modBanFromCommunityOptions &&
                  banned_from_community.length > 0
                ) {
                  await useDatabaseFunctions(
                    'communityBans',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        banned_from_community.map((banView) =>
                          this.#handleEntry({
                            entry: { banView },
                            options: modBanFromCommunityOptions!,
                            getStorageInfo: get,
                            id: banView.mod_ban_from_community.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (
                  modAddModToCommunityOptions &&
                  added_to_community.length > 0
                ) {
                  await useDatabaseFunctions(
                    'modsAddedToCommunities',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        added_to_community.map((modAddedToCommunityView) =>
                          this.#handleEntry({
                            entry: { modAddedToCommunityView },
                            options: modAddModToCommunityOptions!,
                            getStorageInfo: get,
                            id: modAddedToCommunityView.mod_add_community.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (
                  modTransferCommunityOptions &&
                  transferred_to_community.length > 0
                ) {
                  await useDatabaseFunctions(
                    'modsTransferredToCommunities',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        transferred_to_community.map(
                          (modTransferredToCommunityView) =>
                            this.#handleEntry({
                              entry: { modTransferredToCommunityView },
                              options: modTransferCommunityOptions!,
                              getStorageInfo: get,
                              id: modTransferredToCommunityView
                                .mod_transfer_community.id,
                              upsert
                            })
                        )
                      );
                    }
                  );
                }

                if (modBanFromSiteOptions && banned.length > 0) {
                  await useDatabaseFunctions(
                    'siteBans',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        banned.map((banView) =>
                          this.#handleEntry({
                            entry: { banView },
                            options: modBanFromSiteOptions!,
                            getStorageInfo: get,
                            id: banView.mod_ban.id,
                            upsert
                          })
                        )
                      );
                    }
                  );
                }

                if (modAddAdminOptions && added.length > 0) {
                  await useDatabaseFunctions(
                    'adminsAdded',
                    async ({ get, upsert }) => {
                      await Promise.all(
                        added.map((addedAdminView) =>
                          this.#handleEntry({
                            entry: { addedAdminView },
                            options: modAddAdminOptions,
                            getStorageInfo: get,
                            upsert,
                            id: addedAdminView.mod_add.id
                          })
                        )
                      );
                    }
                  );
                }
                break;
              }
              case 'Search': {
                const { communities, users } = response.data as SearchResponse;
                for (const [
                  key,
                  searchOptions
                ] of this.#unfinishedSearchMap.entries()) {
                  this.#unfinishedSearchMap.delete(key);
                  let id: number | null = null;

                  if (searchOptions.type === SearchType.Communities) {
                    for (const { community } of communities) {
                      if (
                        (community.name === searchOptions.name ||
                          community.title === searchOptions.name) &&
                        extractInstanceFromActorId(community.actor_id) ===
                          searchOptions.instance
                      ) {
                        id = community.id;
                        break;
                      }
                    }
                  } else {
                    for (const { person } of users) {
                      if (
                        (person.name === searchOptions.name ||
                          person.display_name === searchOptions.name) &&
                        extractInstanceFromActorId(person.actor_id) ===
                          searchOptions.instance
                      ) {
                        id = person.id;
                        break;
                      }
                    }
                  }

                  this.#finishedSearchMap.set(key, id);
                }
                break;
              }
              default: {
                if (response.error) {
                  console.log(`Got error: ${response.error}`);
                }
              }
            }
          }
        }
      });

      const runChecker = (
        checker: (conn: Connection, auth?: string) => void,
        secondsBetweenPolls: number = defaultSecondsBetweenPolls
      ) => {
        if (this.#connection?.connected && (this.#auth || !credentials)) {
          checker(this.#connection, this.#auth);
          const timeout = setTimeout(() => {
            runChecker(checker, secondsBetweenPolls);
            this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
          }, 1000 * secondsBetweenPolls);

          this.#timeouts.push(timeout);
        } else if (this.#connection?.connected && credentials && !this.#auth) {
          this.#login();

          const timeout = setTimeout(() => {
            runChecker(checker, secondsBetweenPolls);
            this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
          }, 5000);

          this.#timeouts.push(timeout);
        } else if (!this.#forcingClosed) {
          const timeout = setTimeout(() => {
            client.connect(getSecureWebsocketUrl(this.#instance));
            this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
            // If bot can't connect, try again in the number of minutes provided
          }, 1000 * 60 * minutesBeforeRetryConnection);
          this.#timeouts.push(timeout);
        } else {
          this.#forcingClosed = false;

          while (this.#timeouts.length > 0) {
            clearTimeout(this.#timeouts.pop());
          }
        }
      };

      const runBot = async () => {
        await setupDB();

        if (credentials) {
          this.#login();
        }

        if (this.#delayedTasks.length > 0) {
          await Promise.all(this.#delayedTasks);
        }

        for (const task of this.#tasks) {
          task.start();
        }

        const listingType = getListingType(this.#federationOptions);

        if (postOptions) {
          runChecker(
            (conn, auth) => getPosts(conn, listingType, auth),
            postOptions.secondsBetweenPolls
          );
        }

        if (commentOptions) {
          runChecker(
            (conn, auth) => getComments(conn, listingType, auth),
            commentOptions.secondsBetweenPolls
          );
        }

        if (privateMessageOptions && credentials) {
          runChecker(
            getPrivateMessages,
            privateMessageOptions.secondsBetweenPolls
          );
        }

        if (registrationAppicationOptions && credentials) {
          runChecker(
            getRegistrationApplications,
            registrationAppicationOptions.secondsBetweenPolls
          );
        }

        if (mentionOptions && credentials) {
          runChecker(getMentions, mentionOptions.secondsBetweenPolls);
        }

        if (replyOptions && credentials) {
          runChecker(getReplies, replyOptions.secondsBetweenPolls);
        }

        if (commentReportOptions && credentials) {
          runChecker(
            getCommentReports,
            commentReportOptions.secondsBetweenPolls
          );
        }

        if (postReportOptions && credentials) {
          runChecker(getPostReports, postReportOptions.secondsBetweenPolls);
        }

        if (privateMessageReportOptions && credentials) {
          runChecker(
            getPrivateMessageReports,
            privateMessageReportOptions.secondsBetweenPolls
          );
        }

        if (modRemovePostOptions) {
          runChecker(getRemovedPosts, modRemovePostOptions.secondsBetweenPolls);
        }

        if (modLockPostOptions) {
          runChecker(getLockedPosts, modLockPostOptions.secondsBetweenPolls);
        }

        if (modFeaturePostOptions) {
          runChecker(
            getFeaturedPosts,
            modFeaturePostOptions.secondsBetweenPolls
          );
        }

        if (modRemoveCommentOptions) {
          runChecker(
            getRemovedComments,
            modRemoveCommentOptions.secondsBetweenPolls
          );
        }

        if (modRemoveCommunityOptions) {
          runChecker(
            getRemovedCommunities,
            modRemoveCommunityOptions.secondsBetweenPolls
          );
        }

        if (modBanFromCommunityOptions) {
          runChecker(
            getBansFromCommunities,
            modBanFromCommunityOptions.secondsBetweenPolls
          );
        }

        if (modAddModToCommunityOptions) {
          runChecker(
            getModsAddedToCommunities,
            modAddModToCommunityOptions.secondsBetweenPolls
          );
        }

        if (modTransferCommunityOptions) {
          runChecker(
            getModsTransferringCommunities,
            modTransferCommunityOptions.secondsBetweenPolls
          );
        }

        if (modAddAdminOptions) {
          runChecker(getAddedAdmins, modAddAdminOptions.secondsBetweenPolls);
        }

        if (modBanFromSiteOptions) {
          runChecker(
            getBansFromSite,
            modBanFromSiteOptions.secondsBetweenPolls
          );
        }
      };

      await runBot();
    });
  }

  start() {
    if (!this.#connection) {
      client.connect(getSecureWebsocketUrl(this.#instance));
    }
  }

  stop() {
    if (this.#connection) {
      this.#forcingClosed = true;
      for (const task of this.#tasks) {
        task.stop();
      }
      this.#connection.close();
    }
  }

  #login() {
    if (this.#connection && this.#username && this.#password) {
      logIn({
        connection: this.#connection,
        username: this.#username,
        password: this.#password
      });
    }
  }

  async #handleEntry<T>({
    getStorageInfo,
    upsert,
    options,
    id,
    entry
  }: {
    getStorageInfo: StorageInfoGetter;
    upsert: RowUpserter;
    options: HandlerOptions<T>;
    id: number;
    entry: T;
  }) {
    const storageInfo = await getStorageInfo(id);
    if (shouldProcess(storageInfo)) {
      const { get, preventReprocess, reprocess } = getReprocessFunctions(
        options?.minutesUntilReprocess ?? this.#defaultMinutesUntilReprocess
      );

      options!.handle!({
        botActions: this.#botActions,
        preventReprocess,
        reprocess,
        ...entry
      });

      await upsert(id, get());
    }
  }

  #filterInstancesFromResponse<T extends PostView | CommentView>(
    response: T[]
  ) {
    let data = response;

    if (
      (this.#federationOptions.allowList?.length ?? 0) > 0 &&
      !this.#federationOptions.allowList?.includes(this.#instance)
    ) {
      const instanceRegex = getInstanceRegex(
        this.#federationOptions.allowList!
      );

      data = data.filter((d) => instanceRegex.test(d.community.actor_id));
    }

    if ((this.#federationOptions.blockList?.length ?? 0) > 0) {
      const instanceRegex = getInstanceRegex(
        this.#federationOptions.blockList!
      );

      data = data.filter((d) => !instanceRegex.test(d.community.actor_id));
    }

    return data;
  }

  #getId(
    options: SearchOptions,
    type: SearchType.Communities | SearchType.Users,
    label: string
  ) {
    return new Promise<number | null>((resolve, reject) => {
      if (this.#connection) {
        const key = uuidv4();
        this.#unfinishedSearchMap.set(key, {
          ...options,
          type
        });

        createSearch({
          connection: this.#connection,
          auth: this.#auth,
          query: options.name,
          type
        });

        let tries = 0;

        const timeoutFunction = () => {
          const result = this.#finishedSearchMap.get(key);
          if (result !== undefined) {
            this.#finishedSearchMap.delete(key);

            resolve(result);
          } else if (tries < 20) {
            ++tries;
            setTimeout(timeoutFunction, 1000);
          } else {
            reject(`Could not get ${label} ID`);
          }
        };

        setTimeout(timeoutFunction, 1000);
      }

      reject('Connection closed');
    });
  }
}
