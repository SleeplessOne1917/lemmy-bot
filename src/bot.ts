import { connection as Connection, client as WebsocketClient } from 'websocket';

import { CommentView, LoginResponse } from 'lemmy-js-client';
import { getInsecureWebsocketUrl, getSecureWebsocketUrl } from './helpers';
import { createComment, getComments, logIn } from './actions';
import { GetCommentsResponse } from 'lemmy-js-client';
import { setupDB, useDatabaseFunctions } from './db';

type LemmyBotOptions = {
  username: string;
  password: string;
  instanceDomain: string;
  onConnectionFailed?: (e: Error) => void;
  onConnectionError?: (e: Error) => void;
  secondsBetweenPolls?: number;
  minutesBeforeRetryConnection?: number;
  onComment?: (options: {
    comment: CommentView;
    bot: LemmyBot;
    alreadyReplied: boolean;
  }) => void;
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

  constructor({
    onConnectionFailed,
    onConnectionError,
    instanceDomain,
    username,
    password,
    minutesBeforeRetryConnection = 5,
    secondsBetweenPolls = 10,
    onComment,
  }: LemmyBotOptions) {
    this.#instanceDomain = instanceDomain;
    this.#username = username;
    this.#password = password;

    wsClient.on('connectFailed', (e) => {
      if (this.#tryInsecureWs) {
        console.log('Connection Failed!');

        this.#tryInsecureWs = false;

        if (onConnectionFailed) {
          onConnectionFailed(e);
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

        if (onConnectionError) {
          onConnectionError(error);
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
                  useDatabaseFunctions(async ({ repliedToComment }) => {
                    onComment!({
                      comment,
                      bot: this,
                      alreadyReplied: await repliedToComment(
                        comment.comment.id
                      ),
                    });
                  });
                }
                break;
            }
          }
        }
      });

      const runBot = () => {
        if (connection.connected) {
          if (onComment) {
            getComments(connection);
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

  replyToComment(comment: CommentView, content: string) {
    if (this.#connection && this.#auth) {
      console.log(
        `Replying to comment ID ${comment.comment.id} by ${comment.creator.name}`
      );
      createComment({
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
  }
}
