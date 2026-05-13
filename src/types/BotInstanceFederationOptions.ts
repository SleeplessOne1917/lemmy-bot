export type BotInstanceFederationOptions = {
  /**
   * Domain name of the instance to allow/block content from.
   *
   * @example
   * ```
   * 'lemmy.ml'
   * ```
   */
  instance: string;
  /**
   * Communities to filter. Uses the community name in the actor ID, e.g.
   * if targeting https://lemmy.ml/c/asklemmy, use the value 'asklemmy'
   */
  communities: string[];
};
