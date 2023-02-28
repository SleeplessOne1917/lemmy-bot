import { connection as Connection, client as WebsocketClient } from 'websocket';

import {
  CommentView,
  GetPostsResponse,
  LoginResponse,
  PostView,
  PrivateMessagesResponse,
  PrivateMessageView
} from 'lemmy-js-client';
import {
  correctVote,
  getInsecureWebsocketUrl,
  getSecureWebsocketUrl,
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
import { GetCommentsResponse } from 'lemmy-js-client';
import { setupDB, StoredData, useDatabaseFunctions } from './db';

const DEFAULT_POLLING_SECONDS = 10;

type LemmyBotOptions = {
  username: string;
  password: string;
  instanceDomain: string;
  handleConnectionFailed?: (e: Error) => void;
  handleConnectionError?: (e: Error) => void;
  minutesBeforeRetryConnection?: number;
  commentInfo?: {
    handleComment: (options: {
      comment: CommentView;
      botActions: BotActions;
      storedData: StoredData;
    }) => Promise<void>;
    secondsBetweenPolls?: number;
  };
  postInfo?: {
    handlePost: (options: {
      post: PostView;
      botActions: BotActions;
      storedData: StoredData;
    }) => Promise<void>;
    secondsBetweenPolls?: number;
  };
  privateMessageInfo?: {
    handlePrivateMessage: (options: {
      message: PrivateMessageView;
      botActions: BotActions;
    }) => void;
    secondsBetweenPolls?: number;
  };
};

type BotActions = {
  replyToComment: (comment: CommentView, content: string) => Promise<void>;
  reportComment: (comment: CommentView, reason: string) => Promise<void>;
  replyToPost: (post: PostView, content: string) => Promise<void>;
  reportPost: (post: PostView, reason: string) => Promise<void>;
  votePost: (post: PostView, vote: Vote) => Promise<void>;
  voteComment: (comment: CommentView, vote: Vote) => Promise<void>;
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
    replyToPost: async (post, content) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Replying to post ID ${post.post.id} by ${post.creator.name}`
        );
        await createComment({
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
    reportPost: async (post, reason) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Reporting to post ID ${post.post.id} by ${post.creator.name} for ${reason}`
        );
        await createPostReport({
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
    votePost: async (post, vote) => {
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
    replyToComment: async (comment: CommentView, content: string) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Replying to comment ID ${comment.comment.id} by ${comment.creator.name}`
        );
        await createComment({
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
    reportComment: async (comment, reason) => {
      if (this.#connection && this.#auth) {
        console.log(
          `Reporting to comment ID ${comment.comment.id} by ${comment.creator.name} for ${reason}`
        );
        await createCommentReport({
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
    voteComment: async (comment, vote) => {
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
    commentInfo,
    handleConnectionError,
    instanceDomain,
    username,
    password,
    minutesBeforeRetryConnection = 5,
    handleConnectionFailed,
    postInfo,
    privateMessageInfo
  }: LemmyBotOptions) {
    this.#instanceDomain = instanceDomain;
    this.#username = username;
    this.#password = password;

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
                    async ({ getCommentStoredData }) => {
                      comment.my_vote = comment.my_vote ?? Vote.Neutral;
                      await commentInfo!.handleComment({
                        comment,
                        botActions: this.#botActions,
                        storedData: await getCommentStoredData(
                          comment.comment.id
                        )
                      });
                    }
                  );
                }
                break;
              }
              case 'GetPosts': {
                const { posts } = response.data as GetPostsResponse;
                for (const post of posts) {
                  await useDatabaseFunctions(async ({ getPostStoredData }) => {
                    post.my_vote = post.my_vote ?? Vote.Neutral;
                    await postInfo!.handlePost({
                      post,
                      botActions: this.#botActions,
                      storedData: await getPostStoredData(post.post.id)
                    });
                  });
                }
                break;
              }
              case 'GetPrivateMessages': {
                const { private_messages } =
                  response.data as PrivateMessagesResponse;
                for (const message of private_messages) {
                  privateMessageInfo!.handlePrivateMessage!({
                    botActions: this.#botActions,
                    message
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

        if (postInfo) {
          runChecker(
            getPosts,
            postInfo.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
          );
        }

        if (commentInfo) {
          runChecker(
            getComments,
            commentInfo.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
          );
        }

        if (privateMessageInfo) {
          runChecker(
            (conn) =>
              getPrivateMessages({ connection: conn, auth: this.#auth ?? '' }),
            privateMessageInfo.secondsBetweenPolls ?? DEFAULT_POLLING_SECONDS
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
