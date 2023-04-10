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
  GetModlogResponse,
  PostView,
  CommentView,
  SearchType,
  SearchResponse,
  LemmyHttp,
  GetPostResponse,
  ListingType
} from 'lemmy-js-client';
import {
  correctVote,
  extractInstanceFromActorId,
  getInsecureWebsocketUrl,
  getInstanceRegex,
  getListingType,
  getSecureWebsocketUrl,
  parseHandlers,
  removeItem,
  shouldProcess
} from './helpers';
import {
  createApplicationApproval,
  createBanFromCommunity,
  createBanFromSite,
  createComment,
  createCommentReport,
  createFeaturePost,
  createLockPost,
  createPost,
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
  getPost,
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
import ReprocessHandler from './reprocessHandler';
import cron, { ScheduledTask } from 'node-cron';
import {
  BotActions,
  BotFederationOptions,
  BotHandlerOptions,
  BotInstanceFederationOptions,
  BotOptions,
  SearchOptions,
  Vote,
  InternalSearchOptions
} from './types';

const DEFAULT_SECONDS_BETWEEN_POLLS = 10;
const DEFAULT_MINUTES_BEFORE_RETRY_CONNECTION = 5;
const DEFAULT_MINUTES_UNTIL_REPROCESS: number | undefined = undefined;

const client = new WebsocketClient();

class LemmyBot {
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
  #httpClient: LemmyHttp;
  #dbFile?: string;
  #postIds: number[] = [];
  #postMap: Map<number, PostView[]> = new Map();
  #commentIds: number[] = [];
  #commentMap: Map<number, CommentView> = new Map();
  #listingType: ListingType;
  #currentlyProcessingCommentIds: number[] = [];
  #botActions: BotActions = {
    replyToPost: (postId, content) =>
      this.#performLoggedInBotAction({
        action: () =>
          createComment({
            connection: this.#connection!,
            auth: this.#auth!,
            content,
            postId: postId
          }),
        description: 'post comment',
        logMessage: `Replying to post ID ${postId}`
      }),
    createPost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: 'Creating post',
        action: () =>
          createPost(this.#connection!, {
            ...form,
            auth: this.#auth!
          }),
        description: 'create post'
      }),
    reportPost: (postId, reason) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting to post ID ${postId} for ${reason}`,
        action: () =>
          createPostReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: postId,
            reason
          }),
        description: 'report post'
      }),
    votePost: (postId, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      this.#performLoggedInBotAction({
        logMessage: `${prefix}voting post ID ${postId}`,
        action: () =>
          voteDBPost({
            connection: this.#connection!,
            auth: this.#auth!,
            id: postId,
            vote
          }),
        description: `${prefix.toLowerCase()}vote post`
      });
    },
    replyToComment: ({ commentId, content, postId }) =>
      this.#performLoggedInBotAction({
        logMessage: `Replying to comment ID ${commentId}`,
        action: () =>
          createComment({
            connection: this.#connection!,
            auth: this.#auth!,
            content,
            postId: postId,
            parentId: commentId
          }),
        description: 'post comment'
      }),
    reportComment: (commentId, reason) =>
      this.#performLoggedInBotAction({
        action: () =>
          createCommentReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: commentId,
            reason
          }),
        logMessage: `Reporting to comment ID ${commentId} for ${reason}`,
        description: 'report comment'
      }),
    voteComment: (commentId, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      this.#performLoggedInBotAction({
        logMessage: `${prefix}voting comment ID ${commentId}`,
        action: () =>
          voteDBComment({
            connection: this.#connection!,
            auth: this.#auth!,
            id: commentId,
            vote
          }),
        description: `${prefix.toLowerCase()}vote comment`
      });
    },
    banFromCommunity: (options) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${options.personId} from ${options.communityId}`,
        action: () =>
          createBanFromCommunity({
            ...options,
            auth: this.#auth!,
            connection: this.#connection!
          }),
        description: 'ban user'
      }),
    banFromSite: (options) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${options.personId} from ${
          this.#instance
        }`,
        action: () =>
          createBanFromSite({
            ...options,
            auth: this.#auth!,
            connection: this.#connection!
          }),
        description: 'ban user'
      }),
    sendPrivateMessage: (recipientId, content) =>
      this.#performLoggedInBotAction({
        logMessage: `Sending private message to user ID ${recipientId}`,
        action: () =>
          createPrivateMessage({
            auth: this.#auth!,
            connection: this.#connection!,
            content,
            recipientId
          }),
        description: 'send message'
      }),
    reportPrivateMessage: (messageId, reason) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting private message ID ${messageId}. Reason: ${reason}`,
        action: () =>
          createPrivateMessageReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: messageId,
            reason
          }),
        description: 'report message'
      }),
    approveRegistrationApplication: (applicationId) =>
      this.#performLoggedInBotAction({
        logMessage: `Approving application ID ${applicationId}`,
        action: () =>
          createApplicationApproval({
            auth: this.#auth!,
            connection: this.#connection!,
            approve: true,
            id: applicationId
          }),
        description: 'approve application'
      }),
    rejectRegistrationApplication: (applicationId, denyReason) =>
      this.#performLoggedInBotAction({
        logMessage: `Rejecting application ID ${applicationId}`,
        action: () =>
          createApplicationApproval({
            auth: this.#auth!,
            connection: this.#connection!,
            approve: false,
            id: applicationId,
            denyReason
          }),
        description: 'reject application'
      }),
    removePost: (postId, reason) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing post ID ${postId}`,
        action: () =>
          createRemovePost({
            auth: this.#auth!,
            connection: this.#connection!,
            id: postId,
            removed: true,
            reason
          }),
        description: 'remove post'
      }),
    removeComment: (commentId, reason) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing comment ID ${commentId}`,
        action: () =>
          createRemoveComment({
            auth: this.#auth!,
            connection: this.#connection!,
            id: commentId,
            removed: true,
            reason
          }),
        description: 'remove comment'
      }),
    resolvePostReport: (postReportId) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving post report ID ${postReportId}`,
        action: () =>
          createResolvePostReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: postReportId
          }),
        description: 'resolve post report'
      }),
    resolveCommentReport: (commentReportId) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving comment report ID ${commentReportId}`,
        action: () =>
          createResolveCommentReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: commentReportId
          }),
        description: 'resolve comment report'
      }),
    resolvePrivateMessageReport: (privateMessageReportId) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving private message report ID ${privateMessageReportId}`,
        action: () =>
          createResolvePrivateMessageReport({
            auth: this.#auth!,
            connection: this.#connection!,
            id: privateMessageReportId
          }),
        description: 'resolve message report'
      }),
    featurePost: ({ featureType, featured, postId }) =>
      this.#performLoggedInBotAction({
        logMessage: `${featured ? 'F' : 'Unf'}eaturing report ID ${postId}`,
        action: () =>
          createFeaturePost({
            auth: this.#auth!,
            connection: this.#connection!,
            id: postId,
            featured,
            featureType
          }),
        description: 'feature post'
      }),
    lockPost: (postId, locked) =>
      this.#performLoggedInBotAction({
        logMessage: `${locked ? 'L' : 'Unl'}ocking report ID ${postId}`,
        action: () =>
          createLockPost({
            auth: this.#auth!,
            connection: this.#connection!,
            id: postId,
            locked
          }),
        description: `${locked ? '' : 'un'}lock post`
      }),
    getCommunityId: (options) =>
      this.#getId(options, SearchType.Communities, 'community'),
    getUserId: (options) => this.#getId(options, SearchType.Users, 'user'),
    uploadImage: (image) =>
      this.#httpClient.uploadImage({ image, auth: this.#auth }),
    getPost: (postId) =>
      new Promise((resolve, reject) => {
        if (this.#connection?.connected) {
          this.#postIds.push(postId);

          getPost({
            connection: this.#connection,
            auth: this.#auth,
            id: postId
          });

          let tries = 0;

          const timeoutFunction = () => {
            const postView = this.#postMap.get(postId)?.pop();
            if (postView !== undefined) {
              if (this.#postMap.get(postId)?.length === 0) {
                this.#postMap.delete(postId);
              }
              resolve(postView);
            } else if (tries < 20) {
              ++tries;
              setTimeout(timeoutFunction, 1000);
            } else {
              removeItem(this.#postIds, (id) => id === postId);
              reject(`Could not find post with ID ${postId}`);
            }
          };

          setTimeout(timeoutFunction, 1000);
        } else {
          reject(`Could not get post ${postId}: connection closed`);
        }
      }),
    getComment: (commentId, postId) =>
      new Promise((resolve, reject) => {
        if (this.#connection?.connected) {
          this.#commentIds.push(commentId);

          getComments({
            connection: this.#connection,
            listingType: this.#listingType,
            auth: this.#auth,
            postId
          });

          let tries = 0;

          const timeoutFunction = () => {
            const commentView = this.#commentMap.get(commentId);
            if (commentView !== undefined) {
              this.#commentMap.delete(commentId);
              resolve(commentView);
            } else if (tries < 20) {
              ++tries;
              setTimeout(timeoutFunction, 1000);
            } else {
              removeItem(this.#commentIds, (id) => id === commentId);
              reject(`Could not find comment with ID ${commentId}`);
            }
          };

          setTimeout(timeoutFunction, 1000);
        } else {
          reject(`Could not get comment ${commentId}: connection closed`);
        }
      })
  };

  constructor({
    instance,
    credentials,
    handlers,
    connection: {
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
    dbFile,
    federation,
    schedule
  }: BotOptions) {
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
          throw 'Cannot put bot instance in blocklist unless blocking specific communities';
        } else {
          this.#federationOptions = federation;

          if (
            this.#federationOptions.allowList &&
            !this.#federationOptions.allowList.some(
              (i) =>
                i === instance ||
                (i as BotInstanceFederationOptions).instance === instance
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
                this.#delayedTasks.push(
                  async () => await task.doTask(this.#botActions)
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
    this.#httpClient = new LemmyHttp(`https://${this.#instance}`);
    this.#dbFile = dbFile;
    this.#listingType = getListingType(this.#federationOptions);

    const {
      comment: commentOptions,
      post: postOptions,
      privateMessage: privateMessageOptions,
      registrationApplication: registrationApplicationOptions,
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

    client.on('connectFailed', () => {
      if (!this.#isSecureConnection) {
        console.log('Connection Failed!');

        this.#isSecureConnection = true;
      } else {
        this.#isSecureConnection = false;
        client.connect(getInsecureWebsocketUrl(this.#instance));
        this.#httpClient = new LemmyHttp(`http://${this.#instance}`);
      }
    });

    client.on('connect', async (connection) => {
      console.log('Connected to Lemmy Instance');
      this.#connection = connection;

      connection.on('error', (error) => {
        console.log('Connection error');
        console.log(`Error was: ${error.message}`);
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
                      comments
                        .filter(
                          ({ comment: { id } }) =>
                            !this.#currentlyProcessingCommentIds.includes(id)
                        )
                        .map(async (commentView) => {
                          this.#currentlyProcessingCommentIds.push(
                            commentView.comment.id
                          );

                          if (
                            this.#commentIds.includes(commentView.comment.id)
                          ) {
                            removeItem(
                              this.#commentIds,
                              (id) => id === commentView.comment.id
                            );

                            this.#commentMap.set(
                              commentView.comment.id,
                              commentView
                            );
                          }

                          const result = await this.#handleEntry({
                            getStorageInfo: get,
                            upsert,
                            options: commentOptions!,
                            entry: { commentView },
                            id: commentView.comment.id
                          });

                          removeItem(
                            this.#currentlyProcessingCommentIds,
                            (id) => id === commentView.comment.id
                          );

                          return result;
                        })
                    );
                  },
                  this.#dbFile
                );

                break;
              }

              case 'GetPosts': {
                const posts = this.#filterInstancesFromResponse(
                  (response.data as GetPostsResponse).posts
                );

                await useDatabaseFunctions(
                  'posts',
                  async ({ get, upsert }) => {
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
                  },
                  this.#dbFile
                );

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
                  },
                  this.#dbFile
                );

                break;
              }

              case 'GetPost': {
                const { post_view } = response.data as GetPostResponse;

                removeItem(this.#postIds, (id) => id === post_view.post.id);
                const posts = this.#postMap.get(post_view.post.id);
                if (!posts) {
                  this.#postMap.set(post_view.post.id, [post_view]);
                } else {
                  posts.push(post_view);
                }

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
                          options: registrationApplicationOptions!
                        })
                      )
                    );
                  },
                  this.#dbFile
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
                  },
                  this.#dbFile
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
                  },
                  this.#dbFile
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
                  },
                  this.#dbFile
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
                  },
                  this.#dbFile
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
                  },
                  this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
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
                    },
                    this.#dbFile
                  );
                }

                break;
              }

              case 'Search': {
                const { communities, users } = response.data as SearchResponse;
                for (const [
                  key,
                  { instance, name, type }
                ] of this.#unfinishedSearchMap.entries()) {
                  this.#unfinishedSearchMap.delete(key);
                  let id: number | null = null;
                  const instanceWithoutPort = instance.replace(/:.*/, '');

                  if (type === SearchType.Communities) {
                    for (const { community } of communities) {
                      if (
                        (community.name === name || community.title === name) &&
                        extractInstanceFromActorId(community.actor_id) ===
                          instanceWithoutPort
                      ) {
                        id = community.id;
                        break;
                      }
                    }
                  } else {
                    for (const { person } of users) {
                      if (
                        (person.name === name ||
                          person.display_name === name) &&
                        extractInstanceFromActorId(person.actor_id) ===
                          instanceWithoutPort
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
                if (
                  response.error &&
                  response.error !== 'user_already_exists'
                ) {
                  console.log(`Got error: ${response.error}`);
                }

                break;
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
        await setupDB(this.#dbFile);

        if (credentials) {
          this.#login();
        }

        if (this.#delayedTasks.length > 0) {
          await Promise.all(this.#delayedTasks);
        }

        for (const task of this.#tasks) {
          task.start();
        }

        if (postOptions) {
          runChecker(
            (conn, auth) =>
              getPosts({
                connection: conn,
                listingType: this.#listingType,
                auth,
                sort: postOptions.sort
              }),
            postOptions.secondsBetweenPolls
          );
        }

        if (commentOptions) {
          runChecker(
            (conn, auth) =>
              getComments({
                connection: conn,
                auth,
                listingType: this.#listingType,
                sort: commentOptions.sort
              }),
            commentOptions.secondsBetweenPolls
          );
        }

        if (privateMessageOptions && credentials) {
          runChecker(
            getPrivateMessages,
            privateMessageOptions.secondsBetweenPolls
          );
        }

        if (registrationApplicationOptions && credentials) {
          runChecker(
            getRegistrationApplications,
            registrationApplicationOptions.secondsBetweenPolls
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

  async #handleEntry<
    THandledItem,
    TOptions extends Record<string, any> = Record<string, never>
  >({
    getStorageInfo,
    upsert,
    options,
    id,
    entry
  }: {
    getStorageInfo: StorageInfoGetter;
    upsert: RowUpserter;
    options: BotHandlerOptions<THandledItem, TOptions>;
    id: number;
    entry: THandledItem;
  }) {
    const storageInfo = await getStorageInfo(id);
    if (shouldProcess(storageInfo)) {
      const { get, preventReprocess, reprocess } = new ReprocessHandler(
        options?.minutesUntilReprocess ?? this.#defaultMinutesUntilReprocess
      );

      await options!.handle!({
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
    options: SearchOptions | string,
    type: SearchType.Communities | SearchType.Users,
    label: string
  ) {
    return new Promise<number | undefined>((resolve, reject) => {
      if (this.#connection?.connected) {
        const key = uuidv4();
        let localOptions: SearchOptions;

        if (typeof options === 'string') {
          localOptions = {
            name: options,
            instance: this.#instance
          };
        } else {
          localOptions = options;
        }

        this.#unfinishedSearchMap.set(key, {
          ...localOptions,
          type
        });

        createSearch({
          connection: this.#connection,
          auth: this.#auth,
          query: localOptions.name,
          type
        });

        let tries = 0;

        const timeoutFunction = () => {
          const result = this.#finishedSearchMap.get(key);
          if (result !== undefined) {
            this.#finishedSearchMap.delete(key);

            resolve(result ?? undefined);
          } else if (tries < 20) {
            ++tries;
            setTimeout(timeoutFunction, 1000);
          } else {
            this.#unfinishedSearchMap.delete(key);
            reject(`Could not find ${label} ID`);
          }
        };

        setTimeout(timeoutFunction, 1000);
      } else {
        reject(`Could not get ${label} ID: connection closed`);
      }
    });
  }

  #performLoggedInBotAction({
    logMessage,
    action,
    description
  }: {
    logMessage: string;
    action: () => void;
    description: string;
  }) {
    if (this.#connection && this.#auth) {
      console.log(logMessage);
      action();
    } else {
      console.log(
        `Must be ${
          !this.#connection ? 'connected' : 'logged in'
        } to ${description}`
      );
    }
  }
}

export default LemmyBot;
