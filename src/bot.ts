import { connection as Connection, client as WebsocketClient } from 'websocket';

import {
  CommentView,
  GetPostsResponse,
  LoginResponse,
  PostView,
} from 'lemmy-js-client';
import { getInsecureWebsocketUrl, getSecureWebsocketUrl } from './helpers';
import {
  createComment,
  createCommentReport,
  createPostReport,
  getComments,
  getPosts,
  logIn,
} from './actions';
import { GetCommentsResponse } from 'lemmy-js-client';
import { setupDB, useDatabaseFunctions } from './db';

type LemmyBotOptions = {
  username: string;
  password: string;
  instanceDomain: string;
  handleConnectionFailed?: (e: Error) => void;
  handleConnectionError?: (e: Error) => void;
  secondsBetweenPolls?: number;
  minutesBeforeRetryConnection?: number;
  handleComment?: (options: {
    comment: CommentView;
    botActions: BotActions;
    alreadyReplied: boolean;
    alreadyReported: boolean;
  }) => Promise<void>;
  handlePost?: (options: {
    post: PostView;
    botActions: BotActions;
    alreadyReplied: boolean;
    alreadyReported: boolean;
  }) => Promise<void>;
};

type BotActions = {
  replyToComment: (comment: CommentView, content: string) => Promise<void>;
  reportComment: (comment: CommentView, reason: string) => Promise<void>;
  replyToPost: (post: PostView, content: string) => Promise<void>;
  reportPost: (post: PostView, reason: string) => Promise<void>;
};

const wsClient = new WebsocketClient();

export class LemmyBot {
  #instanceDomain: string;
  #username: string;
  #password: string;
  #connection: Connection | undefined = undefined;
  #forcingClosed = false;
  #restartTimeout: NodeJS.Timeout | undefined = undefined;
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
          postId: post.post.id,
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
          reason,
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to report post'
            : 'Must log in to report post'
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
          parentId: comment.comment.id,
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
          reason,
        });
      } else {
        console.log(
          !this.#connection
            ? 'Must be connected to report comment'
            : 'Must log in to report comment'
        );
      }
    },
  };

  constructor({
    handleComment,
    handleConnectionError,
    instanceDomain,
    username,
    password,
    minutesBeforeRetryConnection = 5,
    secondsBetweenPolls = 10,
    handleConnectionFailed,
    handlePost,
  }: LemmyBotOptions) {
    this.#instanceDomain = instanceDomain;
    this.#username = username;
    this.#password = password;

    wsClient.on('connectFailed', (e) => {
      if (this.#tryInsecureWs) {
        console.log('Connection Failed!');

        this.#tryInsecureWs = false;

        if (handleConnectionFailed) {
          handleConnectionFailed(e);
        }
      } else {
        this.#tryInsecureWs = true;
        wsClient.connect(getInsecureWebsocketUrl(this.#instanceDomain));
      }
    });

    wsClient.on('connect', async (connection) => {
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
              case 'Login':
                console.log('Logging in');
                this.#auth = (response.data as LoginResponse).jwt;
                break;

              case 'GetComments':
                const { comments } = response.data as GetCommentsResponse;
                for (const comment of comments) {
                  await useDatabaseFunctions(
                    async ({ repliedToComment, reportedComment }) => {
                      await handleComment!({
                        comment,
                        botActions: this.#botActions,
                        alreadyReplied: await repliedToComment(
                          comment.comment.id
                        ),
                        alreadyReported: await reportedComment(
                          comment.comment.id
                        ),
                      });
                    }
                  );
                }
                break;

              case 'GetPosts':
                const { posts } = response.data as GetPostsResponse;
                for (const post of posts) {
                  await useDatabaseFunctions(
                    async ({ repliedToPost, reportedPost }) => {
                      await handlePost!({
                        post,
                        botActions: this.#botActions,
                        alreadyReplied: await repliedToPost(post.post.id),
                        alreadyReported: await reportedPost(post.post.id),
                      });
                    }
                  );
                }
                break;
            }
          }
        }
      });

      const runBot = () => {
        if (connection.connected) {
          if (handleComment) {
            getComments(connection);
          }

          if (handlePost) {
            getPosts(connection);
          }

          setTimeout(runBot, 1000 * secondsBetweenPolls);
        } else if (!this.#forcingClosed) {
          this.#restartTimeout = setTimeout(() => {
            wsClient.connect(getSecureWebsocketUrl(this.#instanceDomain));
          }, 1000 * 60 * minutesBeforeRetryConnection); // If bot can't connect, try again in the number of minutes provided
        } else {
          this.#forcingClosed = false;
          if (this.#restartTimeout) {
            clearTimeout(this.#restartTimeout);
          }
        }
      };

      await setupDB();
      this.#login();
      runBot();
    });
  }

  start() {
    if (!this.#connection) {
      wsClient.connect(getSecureWebsocketUrl(this.#instanceDomain));
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
      logIn(this.#connection, this.#username, this.#password);
    }
  }
}
