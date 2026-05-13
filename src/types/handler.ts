import {
  LemmyHttp,
  CommentView,
  CommentSortType,
  PostView,
  SortType,
  PrivateMessageView,
  RegistrationApplicationView,
  PersonMentionView,
  CommentReplyView,
  CommentReportView,
  PostReportView,
  PrivateMessageReportView,
  ModRemovePostView,
  ModLockPostView,
  ModFeaturePostView,
  ModRemoveCommentView,
  ModRemoveCommunityView,
  ModBanFromCommunityView,
  ModAddCommunityView,
  ModTransferCommunityView,
  ModAddView,
  ModBanView
} from 'lemmy-js-client';
import { BotActions } from '..';

type Handler<T> = (
  options: {
    botActions: BotActions;
    /**
     * Prevent bot from processing item again, even if the item handler is configured to reprocess
     */
    preventReprocess: () => void;
    /**
     * Mark an item to be reprocessed if it is encountered again, even is item handler is configured to not reprocess
     *
     * NOTE: An item being marked as able to be reprocessed does not necessarily mean that it will be reprocessed.
     *
     * @param minutes - minutes until item is valid to reprocess again
     */
    reprocess: (minutes: number) => void;
    __httpClient__: LemmyHttp;
  } & T
) => Promise<void> | void;

export type InternalHandlers = {
  comment?: BotHandlerOptions<
    { commentView: CommentView },
    { sort?: CommentSortType }
  >;
  post?: BotHandlerOptions<{ postView: PostView }, { sort?: SortType }>;
  privateMessage?: BotHandlerOptions<{ messageView: PrivateMessageView }>;
  registrationApplication?: BotHandlerOptions<{
    applicationView: RegistrationApplicationView;
  }>;
  mention?: BotHandlerOptions<{ mentionView: PersonMentionView }>;
  reply?: BotHandlerOptions<{ replyView: CommentReplyView }>;
  commentReport?: BotHandlerOptions<{ reportView: CommentReportView }>;
  postReport?: BotHandlerOptions<{ reportView: PostReportView }>;
  privateMessageReport?: BotHandlerOptions<{
    reportView: PrivateMessageReportView;
  }>;
  modRemovePost?: BotHandlerOptions<{ removedPostView: ModRemovePostView }>;
  modLockPost?: BotHandlerOptions<{ lockedPostView: ModLockPostView }>;
  modFeaturePost?: BotHandlerOptions<{ featuredPostView: ModFeaturePostView }>;
  modRemoveComment?: BotHandlerOptions<{
    removedCommentView: ModRemoveCommentView;
  }>;
  modRemoveCommunity?: BotHandlerOptions<{
    removedCommunityView: ModRemoveCommunityView;
  }>;
  modBanFromCommunity?: BotHandlerOptions<{ banView: ModBanFromCommunityView }>;
  modAddModToCommunity?: BotHandlerOptions<{
    modAddedToCommunityView: ModAddCommunityView;
  }>;
  modTransferCommunity?: BotHandlerOptions<{
    modTransferredToCommunityView: ModTransferCommunityView;
  }>;
  modAddAdmin?: BotHandlerOptions<{ addedAdminView: ModAddView }>;
  modBanFromSite?: BotHandlerOptions<{ banView: ModBanView }>;
};

export type BotHandlerOptions<
  THandledItem,
  TOptions extends Record<string, any> = object
> = {
  handle: Handler<THandledItem>;
  /**
   * Seconds between each fetch of data.
   * Overrides the value set in {@link BotConnectionOptions.secondsBetweenPolls}
   *
   * @defaultValue 10
   */
  secondsBetweenPolls?: number;
  /**
   * Minutes until an item is able to be reprocessed. Items will not be reprocessed at all if not provided.
   * Overrides the value set in {@link BotConnectionOptions.minutesUntilReprocess}
   *
   * NOTE: An item being marked as able to be reprocessed does not necessarily mean that it will be reprocessed.
   *
   * @defaultValue undefined
   */
  minutesUntilReprocess?: number;
} & TOptions;

export type BotHandlers = {
  [K in keyof InternalHandlers]?: InternalHandlers[K] extends
    | BotHandlerOptions<infer U, infer O>
    | undefined
    ? BotHandlerOptions<U, O> | Handler<U>
    : undefined;
};
