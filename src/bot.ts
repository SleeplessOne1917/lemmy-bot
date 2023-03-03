import { connection as Connection, client as WebsocketClient } from 'websocket';

import {
  CommentView,
  GetPostsResponse,
  LoginResponse,
  PostView,
  PrivateMessagesResponse,
  PrivateMessageView,
  GetCommentsResponse,
  RegistrationApplicationView,
  ListRegistrationApplicationsResponse,
  PersonMentionView,
  GetPersonMentionsResponse,
  CommentReplyView,
  GetRepliesResponse,
  CommentReportView,
  ListCommentReportsResponse,
  PostReportView,
  ListPostReportsResponse,
  PrivateMessageReportView,
  ListPrivateMessageReportsResponse,
  PostFeatureType,
  ModRemovePostView,
  GetModlogResponse
} from 'lemmy-js-client';
import {
  correctVote,
  getInsecureWebsocketUrl,
  getSecureWebsocketUrl,
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
  enableBotAccount,
  getCommentReports,
  getComments,
  getMentions,
  getPostReports,
  getPosts,
  getPrivateMessageReports,
  getPrivateMessages,
  getRegistrationApplications,
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

const DEFAULT_POLLING_SECONDS = 10;

type Handler<T> = (
  options: {
    botActions: BotActions;
    preventReprocess: () => void;
    reprocess: (minutes: number) => void;
  } & T
) => void;

type HandlerOptions<T> = {
  handle: Handler<T>;
  secondsBetweenPolls?: number;
  minutesUntilReprocess?: number;
};

type LemmyBotOptions = {
  username: string;
  password: string;
  instanceDomain: string;
  handleConnectionFailed?: (e: Error) => void;
  handleConnectionError?: (e: Error) => void;
  minutesBeforeRetryConnection?: number;
  handlerOptions?: {
    comment?: HandlerOptions<{ comment: CommentView }>;
    post?: HandlerOptions<{ post: PostView }>;
    privateMessage?: HandlerOptions<{ message: PrivateMessageView }>;
    registrationApplication?: HandlerOptions<{
      application: RegistrationApplicationView;
    }>;
    mention?: HandlerOptions<{ mention: PersonMentionView }>;
    reply?: HandlerOptions<{ reply: CommentReplyView }>;
    commentReport?: HandlerOptions<{ report: CommentReportView }>;
    postReport?: HandlerOptions<{ report: PostReportView }>;
    privateMessageReport?: HandlerOptions<{ report: PrivateMessageReportView }>;
    modRemovePost?: HandlerOptions<{ removedPost: ModRemovePostView }>;
  };
};

type BotActions = {
  replyToComment: (comment: CommentView, content: string) => void;
  reportComment: (comment: CommentView, reason: string) => void;
  replyToPost: (post: PostView, content: string) => void;
  reportPost: (post: PostView, reason: string) => void;
  votePost: (post: PostView, vote: Vote) => void;
  voteComment: (comment: CommentView, vote: Vote) => void;
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
};

const client = new WebsocketClient();

export class LemmyBot {
  #instanceDomain: string;
  #username: string;
  #password: string;
  #connection: Connection | undefined = undefined;
  #forcingClosed = false;
  #timeouts: NodeJS.Timeout[] = [];
  #auth: string | undefined = undefined;
  #tryInsecureWs = false;
  #botActions: BotActions = {
    replyToPost: (post, content) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Replying to post ID ${post.post.id} by ${post.creator.name}`
        );
        createComment({
          connection: this.#connection,
          auth: this.#auth,
          content,
          postId: post.post.id
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to post comment'
            : 'Must log in to post comment'
        );
      }
    },
    reportPost: (post, reason) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Reporting to post ID ${post.post.id} by ${post.creator.name} for ${reason}`
        );
        createPostReport({
          auth: this.#auth,
          connection: this.#connection,
          id: post.post.id,
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
    votePost: (post, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      if (this.#connection && this.#auth) {
        console.log(
          `${prefix}voting post ID ${post.post.id} by ${post.creator.name}`
        );
        voteDBPost({
          connection: this.#connection,
          auth: this.#auth,
          id: post.post.id,
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
    replyToComment: (comment: CommentView, content: string) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Replying to comment ID ${comment.comment.id} by ${comment.creator.name}`
        );
        createComment({
          connection: this.#connection,
          auth: this.#auth,
          content,
          postId: comment.post.id,
          parentId: comment.comment.id
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to post comment'
            : 'Must log in to post comment'
        );
      }
    },
    reportComment: (comment, reason) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Reporting to comment ID ${comment.comment.id} by ${comment.creator.name} for ${reason}`
        );
        createCommentReport({
          auth: this.#auth,
          connection: this.#connection,
          id: comment.comment.id,
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
    voteComment: (comment, vote) => {
      vote = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      if (this.#connection && this.#auth) {
        console.log(
          `${prefix}voting comment ID ${comment.comment.id} by ${comment.creator.name}`
        );
        voteDBComment({
          connection: this.#connection,
          auth: this.#auth,
          id: comment.comment.id,
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
          `Banning user ID ${options.personId} from ${this.#instanceDomain}`
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
    }
  };

  constructor({
    handleConnectionError,
    instanceDomain,
    username,
    password,
    minutesBeforeRetryConnection = 5,
    handleConnectionFailed,
    handlerOptions
  }: LemmyBotOptions) {
    this.#instanceDomain = instanceDomain;
    this.#username = username;
    this.#password = password;

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
      modRemovePost: modRemovePostOptions
    } = handlerOptions ?? {};

    client.on('connectFailed', (e) => {
      if (this.#tryInsecureWs) {
        console.log('Connection Failed!');

        this.#tryInsecureWs = false;

        if (handleConnectionFailed) {
          handleConnectionFailed(e);
        }
      } else {
        this.#tryInsecureWs = true;
        client.connect(getInsecureWebsocketUrl(this.#instanceDomain));
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
                const { comments } = response.data as GetCommentsResponse;
                await useDatabaseFunctions(
                  'comments',
                  async ({ get, upsert }) => {
                    for (const comment of comments) {
                      await this.#handleEntry({
                        getStorageInfo: get,
                        upsert,
                        options: commentOptions!,
                        entry: { comment },
                        id: comment.comment.id
                      });
                    }
                  }
                );
                break;
              }
              case 'GetPosts': {
                const { posts } = response.data as GetPostsResponse;
                await useDatabaseFunctions('posts', async ({ get, upsert }) => {
                  for (const post of posts) {
                    await this.#handleEntry({
                      getStorageInfo: get,
                      upsert,
                      entry: { post },
                      id: post.post.id,
                      options: postOptions!
                    });
                  }
                });
                break;
              }
              case 'GetPrivateMessages': {
                const { private_messages } =
                  response.data as PrivateMessagesResponse;
                await useDatabaseFunctions(
                  'messages',
                  async ({ get, upsert }) => {
                    for (const message of private_messages) {
                      await this.#handleEntry({
                        getStorageInfo: get,
                        options: privateMessageOptions!,
                        entry: { message },
                        id: message.private_message.id,
                        upsert
                      });

                      if (this.#connection && this.#auth) {
                        markPrivateMessageAsRead({
                          auth: this.#auth,
                          connection: this.#connection,
                          id: message.private_message.id
                        });

                        console.log(
                          `Marked private message ID ${message.private_message.id} from ${message.creator.id} as read`
                        );
                      }
                    }
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
                    for (const application of registration_applications) {
                      await this.#handleEntry({
                        getStorageInfo: get,
                        upsert,
                        entry: { application },
                        id: application.registration_application.id,
                        options: registrationAppicationOptions!
                      });
                    }
                  }
                );
                break;
              }
              case 'GetPersonMentions': {
                const { mentions } = response.data as GetPersonMentionsResponse;
                await useDatabaseFunctions(
                  'mentions',
                  async ({ get, upsert }) => {
                    for (const mention of mentions) {
                      await this.#handleEntry({
                        entry: { mention },
                        options: mentionOptions!,
                        getStorageInfo: get,
                        id: mention.person_mention.id,
                        upsert
                      });

                      if (this.#connection && this.#auth) {
                        markMentionAsRead({
                          connection: this.#connection,
                          auth: this.#auth,
                          id: mention.person_mention.id
                        });
                      }
                    }
                  }
                );
                break;
              }
              case 'GetReplies': {
                const { replies } = response.data as GetRepliesResponse;
                await useDatabaseFunctions(
                  'replies',
                  async ({ get, upsert }) => {
                    for (const reply of replies) {
                      await this.#handleEntry({
                        entry: { reply },
                        options: replyOptions!,
                        getStorageInfo: get,
                        id: reply.comment_reply.id,
                        upsert
                      });

                      if (this.#connection && this.#auth) {
                        markReplyAsRead({
                          connection: this.#connection,
                          auth: this.#auth,
                          id: reply.comment_reply.id
                        });
                      }
                    }
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
                    for (const report of comment_reports) {
                      await this.#handleEntry({
                        entry: { report },
                        options: commentReportOptions!,
                        getStorageInfo: get,
                        id: report.comment_report.id,
                        upsert
                      });
                    }
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
                    for (const report of post_reports) {
                      await this.#handleEntry({
                        entry: { report },
                        options: postReportOptions!,
                        getStorageInfo: get,
                        id: report.post_report.id,
                        upsert
                      });
                    }
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
                    for (const report of private_message_reports) {
                      await this.#handleEntry({
                        entry: { report },
                        options: privateMessageReportOptions!,
                        getStorageInfo: get,
                        id: report.private_message_report.id,
                        upsert
                      });
                    }
                  }
                );
                break;
              }
              case 'GetModlog': {
                const { removed_posts } = response.data as GetModlogResponse;
                await useDatabaseFunctions(
                  'removedPosts',
                  async ({ get, upsert }) => {
                    for (const removedPost of removed_posts) {
                      await this.#handleEntry({
                        entry: { removedPost },
                        options: modRemovePostOptions!,
                        getStorageInfo: get,
                        id: removedPost.mod_remove_post.id,
                        upsert
                      });
                    }
                  }
                );
                break;
              }
              default: {
                console.log(response.op);
                if (response.error) {
                  console.log(`Got error: ${response.error}`);
                }
              }
            }
          }
        }
      });

      const runChecker = (
        checker: (conn: Connection, auth: string) => void,
        secondsBetweenPolls: number = DEFAULT_POLLING_SECONDS
      ) => {
        if (this.#connection?.connected && this.#auth) {
          checker(this.#connection, this.#auth);
          this.#timeouts.push(
            setTimeout(() => {
              runChecker(checker, secondsBetweenPolls);
            }, 1000 * secondsBetweenPolls)
          );
        } else if (this.#connection?.connected) {
          this.#login();

          this.#timeouts.push(
            setTimeout(() => {
              runChecker(checker, secondsBetweenPolls);
            }, 1000 * 5)
          );
        } else if (!this.#forcingClosed) {
          this.#timeouts.push(
            setTimeout(() => {
              client.connect(getSecureWebsocketUrl(this.#instanceDomain));
            }, 1000 * 60 * minutesBeforeRetryConnection)
          ); // If bot can't connect, try again in the number of minutes provided
        } else {
          this.#forcingClosed = false;

          while (this.#timeouts.length > 0) {
            clearTimeout(this.#timeouts.pop());
          }
        }
      };

      const runBot = async () => {
        await setupDB();
        this.#login();

        if (postOptions) {
          runChecker(getPosts, postOptions.secondsBetweenPolls);
        }

        if (commentOptions) {
          runChecker(getComments, commentOptions.secondsBetweenPolls);
        }

        if (privateMessageOptions) {
          runChecker(
            getPrivateMessages,
            privateMessageOptions.secondsBetweenPolls
          );
        }

        if (registrationAppicationOptions) {
          runChecker(
            getRegistrationApplications,
            registrationAppicationOptions.secondsBetweenPolls
          );
        }

        if (mentionOptions) {
          runChecker(getMentions, mentionOptions.secondsBetweenPolls);
        }

        if (replyOptions) {
          runChecker(getReplies, replyOptions.secondsBetweenPolls);
        }

        if (commentReportOptions) {
          runChecker(
            getCommentReports,
            commentReportOptions.secondsBetweenPolls
          );
        }

        if (postReportOptions) {
          runChecker(getPostReports, postReportOptions.secondsBetweenPolls);
        }

        if (privateMessageReportOptions) {
          runChecker(
            getPrivateMessageReports,
            privateMessageReportOptions.secondsBetweenPolls
          );
        }

        if (modRemovePostOptions) {
          runChecker(getRemovedPosts, modRemovePostOptions.secondsBetweenPolls);
        }
      };

      await runBot();
    });
  }

  start() {
    if (!this.#connection) {
      client.connect(getSecureWebsocketUrl(this.#instanceDomain));
    }
  }

  stop() {
    if (this.#connection) {
      this.#forcingClosed = true;
      this.#connection.close();
    }
  }

  #login() {
    if (this.#connection) {
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
        options?.minutesUntilReprocess
      );

      options!.handle!({
        botActions: this.#botActions,
        preventReprocess,
        reprocess,
        ...entry
      });

      upsert(id, get());
    }
  }
}

class ReprocessHandler {
  #minutesUntilReprocess?: number;

  constructor(minutesUntilReprocess?: number) {
    this.#minutesUntilReprocess = minutesUntilReprocess;
  }

  reprocess(minutes: number) {
    this.#minutesUntilReprocess = minutes;
  }

  preventReprocess() {
    this.#minutesUntilReprocess = undefined;
  }

  get() {
    return this.#minutesUntilReprocess;
  }
}

const getReprocessFunctions = (minutes?: number) => {
  const reprocessHandler = new ReprocessHandler(minutes);

  return {
    reprocess: (minutes: number) => reprocessHandler.reprocess(minutes),
    preventReprocess: () => reprocessHandler.preventReprocess(),
    get: () => reprocessHandler.get()
  };
};
