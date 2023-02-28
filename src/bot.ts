import { connection as Connection, client as WebsocketClient } from 'websocket';

import {
  CommentView,
  GetPostsResponse,
  LoginResponse,
  PostView,
  PrivateMessagesResponse,
  PrivateMessageView,
  GetCommentsResponse
} from 'lemmy-js-client';
import {
  correctVote,
  getInsecureWebsocketUrl,
  getSecureWebsocketUrl,
  shouldProcess,
  Vote
} from './helpers';
import {
  createBanFromCommunity,
  createBanFromSite,
  createComment,
  createCommentReport,
  createPostReport,
  createPrivateMessage,
  createPrivateMessageReport,
  enableBotAccount,
  getComments,
  getPosts,
  getPrivateMessages,
  logIn,
  markPrivateMessageAsRead,
  voteDBComment,
  voteDBPost
} from './actions';
import { setupDB, useDatabaseFunctions } from './db';

const DEFAULT_POLLING_SECONDS = 10;

type Handler<T> = (
  options: {
    botActions: BotActions;
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
      privateMessage: privateMessageOptions
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
                for (const comment of comments) {
                  await useDatabaseFunctions(
                    async ({ getCommentStorageInfo, upsertComment }) => {
                      const storageInfo = await getCommentStorageInfo(
                        comment.comment.id
                      );

                      if (shouldProcess(storageInfo)) {
                        comment.my_vote = comment.my_vote ?? Vote.Neutral;
                        await commentOptions!.handle({
                          comment,
                          botActions: this.#botActions
                        });

                        upsertComment(
                          comment.comment.id,
                          commentOptions?.minutesUntilReprocess
                        );
                      }
                    }
                  );
                }
                break;
              }
              case 'GetPosts': {
                const { posts } = response.data as GetPostsResponse;
                for (const post of posts) {
                  await useDatabaseFunctions(
                    async ({ getPostStorageInfo, upsertPost }) => {
                      post.my_vote = post.my_vote ?? Vote.Neutral;
                      const storageInfo = await getPostStorageInfo(
                        post.post.id
                      );

                      if (shouldProcess(storageInfo)) {
                        await postOptions!.handle({
                          post,
                          botActions: this.#botActions
                        });

                        upsertPost(
                          post.post.id,
                          postOptions?.minutesUntilReprocess
                        );
                      }
                    }
                  );
                }
                break;
              }
              case 'GetPrivateMessages': {
                const { private_messages } =
                  response.data as PrivateMessagesResponse;
                for (const message of private_messages) {
                  await useDatabaseFunctions(
                    async ({ getMessageStorageInfo, upsertMessage }) => {
                      const storageInfo = await getMessageStorageInfo(
                        message.private_message.id
                      );
                      if (shouldProcess(storageInfo)) {
                        await privateMessageOptions!.handle!({
                          botActions: this.#botActions,
                          message
                        });

                        upsertMessage(
                          message.private_message.id,
                          privateMessageOptions?.minutesUntilReprocess
                        );
                      }
                    }
                  );

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
        checker: (conn: Connection) => void,
        secondsBetweenPolls: number
      ) => {
        if (this.#connection?.connected) {
          checker(this.#connection);
          this.#timeouts.push(
            setTimeout(() => {
              runChecker(checker, secondsBetweenPolls);
            }, 1000 * secondsBetweenPolls)
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
          runChecker(
            getPosts,
            postOptions.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
          );
        }

        if (commentOptions) {
          runChecker(
            getComments,
            commentOptions.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
          );
        }

        if (privateMessageOptions) {
          runChecker(
            (conn) =>
              getPrivateMessages({ connection: conn, auth: this.#auth ?? '' }),
            privateMessageOptions.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
          );
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
}
