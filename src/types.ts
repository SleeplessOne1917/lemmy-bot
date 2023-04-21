import {
  CommentReplyView,
  CommentReportView,
  CommentSortType,
  CommentView,
  CreatePost as CreateClientPost,
  ModAddCommunityView,
  ModAddView,
  ModBanFromCommunityView,
  ModBanView,
  ModFeaturePostView,
  ModLockPostView,
  ModRemoveCommentView,
  ModRemoveCommunityView,
  ModRemovePostView,
  ModTransferCommunityView,
  PersonMentionView,
  PostReportView,
  PostView,
  PrivateMessageReportView,
  PrivateMessageView,
  RegistrationApplicationView,
  SearchType,
  SortType,
  UploadImageResponse,
  CreateComment as CreateClientComment,
  CreatePostReport,
  CreateCommentReport,
  CreatePostLike,
  CreateCommentLike,
  BanFromCommunity as ClientBanFromCommunity,
  CreatePrivateMessage,
  BanPerson,
  CreatePrivateMessageReport,
  ApproveRegistrationApplication,
  RemoveComment as ClientRemoveComment,
  RemovePost as ClientRemovePost,
  FeaturePost as ClientFeaturePost,
  LockPost as ClientLockPost,
  Comment
} from 'lemmy-js-client';

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
};

export type ParentType = 'post' | 'comment';

export type ParentResponse = {
  type: ParentType;
  data: CommentView | PostView;
};

export type BotActions = {
  reportComment: (form: ReportComment) => void;
  createComment: (form: CreateComment) => void;
  reportPost: (form: ReportPort) => void;
  votePost: (form: VotePost) => void;
  createPost: (form: CreatePost) => void;
  voteComment: (form: VoteComment) => void;
  banFromCommunity: (form: BanFromCommunity) => void;
  banFromSite: (form: BanFromSite) => void;
  sendPrivateMessage: (form: SendPrivateMessage) => void;
  reportPrivateMessage: (form: ReportPrivateMessage) => void;
  approveRegistrationApplication: (applicationId: number) => void;
  rejectRegistrationApplication: (form: RejectApplicationApplication) => void;
  removePost: (form: RemovePost) => void;
  removeComment: (form: RemoveComment) => void;
  resolvePostReport: (postReportId: number) => void;
  resolveCommentReport: (commentReportId: number) => void;
  resolvePrivateMessageReport: (privateMessageReportId: number) => void;
  featurePost: (form: FeaturePost) => void;
  lockPost: (form: LockPost) => void;
  /**
   * Gets a community ID by name.
   *
   * @param options - If just a string, will search for the community on the bot's local instance. Pass a {@link SearchOptions} object to search for a community on another instance
   *
   * @returns The ID of the searched for community, or undefined if not found
   */
  getCommunityId: (
    options: SearchOptions | string
  ) => Promise<number | undefined>;
  /**
   * Gets user ID by name.
   *
   * @param options - If just a string, will search for the user on the bot's local instance. Pass a {@link SearchOptions} object to search for a user on another instance
   *
   * @returns The ID of the searched for user, or undefined if not found
   */
  getUserId: (form: SearchOptions | string) => Promise<number | undefined>;
  uploadImage: (image: Buffer) => Promise<UploadImageResponse>;
  getPost: (postId: number) => Promise<PostView>;
  getComment: (commentId: number) => Promise<CommentView>;
  getParentOfComment: (form: Comment) => Promise<ParentResponse>;
};

export type InternalSearchOptions = {
  name: string;
  instance: string;
  type: SearchType.Communities | SearchType.Users;
};

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
  } & T
) => Promise<void> | void;

export type BotHandlerOptions<
  THandledItem,
  TOptions extends Record<string, any> = Record<string, never>
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
    ? (InternalHandlers[K] & O) | Handler<U>
    : undefined;
};

export enum Vote {
  Upvote = 1,
  Downvote = -1,
  Neutral = 0
}

export type BotInstanceList = (string | BotInstanceFederationOptions)[];

export type BotFederationOptions = {
  allowList?: BotInstanceList;
  blockList?: BotInstanceList;
};

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

export type BotTask = {
  /**
   * Expression used to schedule the task.
   *
   * @see {@link https://www.npmjs.com/package/cron} for details on accepted cron syntax
   */
  cronExpression: string;
  doTask: (botActions: BotActions) => Promise<void>;
  /**
   * Timezone for schedule to run in
   *
   * @see {@link https://momentjs.com/timezone/} for valid timezones
   */
  timezone?: string;
  runAtStart?: boolean;
};

export type BotConnectionOptions = {
  /**
   * Time to wait until retrying connection if connection is lost.
   *
   * @defaultValue 5
   */
  minutesBeforeRetryConnection?: number;
  /**
   * Seconds between each fetch of data.
   * Can be overridden by {@link BotHandlerOptions.secondsBetweenPolls}
   *
   * @defaultValue 10
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

export type BotCredentials = {
  username: string;
  password: string;
};

type OptionalKeys<T extends Record<string, any>> = {
  [K in keyof T]?: Exclude<T, NonNullable<T>> extends never ? never : T[K];
};

type RequiredKeys<T> = {
  [K in keyof T]: Exclude<T, NonNullable<T>> extends never ? T[K] : never;
};

type UnderscoreToCamelCase<T extends string> = T extends `${infer U}_${infer R}`
  ? `${Lowercase<U>}${Capitalize<UnderscoreToCamelCase<R>>}`
  : T;

type UnderscoreToCamelCaseMerge<T extends Record<string, any>> = {
  [K in keyof OptionalKeys<T> as K extends string
    ? UnderscoreToCamelCase<K>
    : K]?: T[K];
} & {
  [K in keyof RequiredKeys<T> as K extends string
    ? UnderscoreToCamelCase<K>
    : K]: T[K];
};

type UnderscoreObjToCamelCaseObj<T extends Record<string, any>> = {
  [K in keyof UnderscoreToCamelCaseMerge<T>]: UnderscoreToCamelCaseMerge<T>[K];
};

export type SearchOptions = Omit<InternalSearchOptions, 'type'>;

export type CreatePost = UnderscoreObjToCamelCaseObj<
  Omit<CreateClientPost, 'auth'>
>;

export type CreateComment = UnderscoreObjToCamelCaseObj<
  Omit<CreateClientComment, 'auth' | 'form_id'>
>;

export type ReportPort = UnderscoreObjToCamelCaseObj<
  Omit<CreatePostReport, 'auth'>
>;

export type ReportComment = UnderscoreObjToCamelCaseObj<
  Omit<CreateCommentReport, 'auth'>
>;

export type VotePost = UnderscoreObjToCamelCaseObj<
  Omit<CreatePostLike, 'auth' | 'score'>
> & { vote: Vote };

export type VoteComment = UnderscoreObjToCamelCaseObj<
  Omit<CreateCommentLike, 'auth' | 'score'>
> & { vote: Vote };

export type BanFromCommunity = UnderscoreObjToCamelCaseObj<
  Omit<ClientBanFromCommunity, 'auth' | 'ban' | 'expires'>
> & { daysUntilExpires?: number };

export type BanFromSite = UnderscoreObjToCamelCaseObj<
  Omit<BanPerson, 'auth' | 'ban' | 'expires'>
> & {
  daysUntilExpires?: number;
};

export type SendPrivateMessage = UnderscoreObjToCamelCaseObj<
  Omit<CreatePrivateMessage, 'auth'>
>;

export type ReportPrivateMessage = UnderscoreObjToCamelCaseObj<
  Omit<CreatePrivateMessageReport, 'auth'>
>;

export type RejectApplicationApplication = UnderscoreObjToCamelCaseObj<
  Omit<ApproveRegistrationApplication, 'approve' | 'auth'>
>;

export type RemovePost = UnderscoreObjToCamelCaseObj<
  Omit<ClientRemovePost, 'auth' | 'removed'>
>;

export type RemoveComment = UnderscoreObjToCamelCaseObj<
  Omit<ClientRemoveComment, 'auth' | 'removed'>
>;

export type FeaturePost = UnderscoreObjToCamelCaseObj<
  Omit<ClientFeaturePost, 'auth'>
>;

export type LockPost = UnderscoreObjToCamelCaseObj<
  Omit<ClientLockPost, 'auth'>
>;
