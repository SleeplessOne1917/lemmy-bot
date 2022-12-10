import { connection as Connection, client as WebsocketClient } from 'websocket';

import { Login } from 'lemmy-js-client';
import { getWebsocketUrl } from './helpers';

type LemmyBotOptions = {
  username: string;
  password: string;
  instanceDomain: string;
  onConnectionFailed?: (e: Error) => void;
  onConnectionError?: (e: Error) => void;
  secondsBetweenPolls?: number;
  minutesBeforeRetryConnection?: number;
};

const wsClient = new WebsocketClient();

export class LemmyBot {
  #instanceDomain: string;
  #username: string;
  #password: string;
  #connection: Connection | undefined = undefined;
  #forcingClosed = false;

  constructor({
    onConnectionFailed,
    onConnectionError,
    instanceDomain,
    username,
    password,
    minutesBeforeRetryConnection = 5,
    secondsBetweenPolls = 10,
  }: LemmyBotOptions) {
    this.#instanceDomain = instanceDomain;
    this.#username = username;
    this.#password = password;

    wsClient.on('connectFailed', (e) => {
      console.log('Connection Failed!');

      if (onConnectionFailed) {
        onConnectionFailed(e);
      }
    });

    wsClient.on('connect', (connection) => {
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
          }
        }
      });

      this.#login();

      const runBot = () => {
        if (connection.connected) {
          setTimeout(runBot, 1000 * secondsBetweenPolls);
        } else if (!this.#forcingClosed) {
          setTimeout(() => {
            wsClient.connect(getWebsocketUrl(this.#instanceDomain));
          }, 1000 * 60 * minutesBeforeRetryConnection); // If bot can't connect, try again in the number of minutes provided
        } else {
          this.#forcingClosed = false;
        }
      };

      runBot();
    });
  }

  start() {
    wsClient.connect(getWebsocketUrl(this.#instanceDomain));
  }

  stop() {
    if (this.#connection) {
      this.#forcingClosed = true;
      this.#connection.close();
    }
  }

  #login() {
    if (this.#connection) {
      console.log('Logging in');
      const logInRequest = new Login({
        username_or_email: this.#username,
        password: this.#password,
      });

      this.#connection.send(logInRequest);
    }
  }
}
