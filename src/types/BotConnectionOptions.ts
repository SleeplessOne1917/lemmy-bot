export type BotConnectionOptions = {
  /**
   * Seconds between each fetch of data. Cannot be lower than 30.
   * Can be overridden by {@link BotHandlerOptions.secondsBetweenPolls}
   *
   * @defaultValue 30
   */
  secondsBetweenPolls?: number;
  /**
   * Minutes until an item is able to be reprocessed. Items will not be reprocessed at all if not provided.
   * Can be overridden by {@link BotHandlerOptions.minutesUntilReprocess}
   *
   * NOTE: An item being marked as able to be reprocessed does not necessarily mean that it will be reprocessed.
   *
   * @defaultValue undefined
   */
  minutesUntilReprocess?: number;
};
