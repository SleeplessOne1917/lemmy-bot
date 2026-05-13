import {
  BotConnectionOptions,
  BotCredentials,
  BotFederationOptions,
  BotHandlers,
  BotTask
} from '..';

export type BotOptions = {
  credentials?: BotCredentials;
  /**
   * Domain name of the instance the bot will run on.
   *
   * @example
   * ```
   * 'lemmy.ml'
   * ```
   */
  instance: string;
  /**
   * Options for a bot's connection
   */
  connection?: BotConnectionOptions;
  /**
   * Options for handling different events, e.g. the creation of a comment,
   * a mod log action, or a private message
   */
  handlers?: BotHandlers;
  /**
   * Controls whether the bot should respond to events from all instances, just the local instance,
   * or a more fine grained selection.
   */
  federation?: 'local' | 'all' | BotFederationOptions;
  /**
   * Task or tasks to be run periodically without needing to respond to events
   */
  schedule?: BotTask | BotTask[];
  /**
   * File to use for SQLite DB. If not provided, will store DB in memory.
   */
  dbFile?: string;
  /**
   * If true, the bot will automatically mark it's account as a bot on sign in.
   * If set to false, make sure not to forget to manually mark the account as a bot.
   *
   * @default true
   */
  markAsBot?: boolean;
  /**
   * If true, the bot will output verbose logs for any operation it conducts.
   * If set to false, no internal logs will be produced.
   *
   * @default true
   */
  enableLogs?: boolean;
  /**
   * If true, the bot will not actually perform any actions.
   * If set to false, the bot will perform actions as normal.
   * Useful for development and testing without affecting a production instance.
   *
   * @default false
   */
  dryRun?: boolean;
  /**
   *  If true, the bot uses HTTPS. If false, it uses HTTP.
   *
   * @default true
   * */
  secure?: boolean;
};
