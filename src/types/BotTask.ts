import { BotActions } from '..';
import { LemmyHttp } from 'lemmy-js-client';

export type BotTask = {
  /**
   * Expression used to schedule the task.
   *
   * @see {@link https://www.npmjs.com/package/cron} for details on accepted cron syntax
   */
  cronExpression: string;
  doTask: (options: {
    botActions: BotActions;
    __httpClient__: LemmyHttp;
  }) => Promise<void>;
  /**
   * Timezone for schedule to run in
   *
   * @see {@link https://momentjs.com/timezone/} for valid timezones
   */
  timezone?: string;
  runAtStart?: boolean;
};
