import {
  CommentReplyView,
  CommentReportView,
  CommentSortType,
  CommentView,
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
  SortType,
  UploadImageResponse,
  CreatePostReport,
  CreateCommentReport,
  CreatePostLike,
  CreateCommentLike,
  CreatePrivateMessage,
  BanPerson,
  CreatePrivateMessageReport,
  ApproveRegistrationApplication,
  Comment,
  ResolveObjectResponse,
  CommentReportResponse,
  CommentResponse,
  PostReportResponse,
  PostResponse,
  BanFromCommunityResponse,
  BanPersonResponse,
  PrivateMessageResponse,
  PrivateMessageReportResponse,
  RegistrationApplicationResponse,
  CommunityResponse,
  LemmyHttp,
  CreateComment,
  EditComment,
  CreatePost,
  EditPost,
  BanFromCommunity,
  RemovePost,
  RemoveComment,
  ResolvePostReport,
  ResolveCommentReport,
  ResolvePrivateMessageReport,
  FeaturePost,
  LockPost,
  GetCommunity,
  GetCommunityResponse,
  FollowCommunity,
  GetPersonDetails,
  GetPersonDetailsResponse,
  GetPost,
  GetPostResponse,
  GetComment,
  Person,
  Community,
  ResolveObject,
  ListCommentLikes,
  ListCommentLikesResponse,
  ListPostLikes,
  ListPostLikesResponse,
  DistinguishComment
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

type ParentPost = {
  type: 'post';
  post: GetPostResponse;
};

type ParentComment = {
  type: 'comment';
  comment: CommentResponse;
};

export type ParentResponse = ParentPost | ParentComment;

export type BotActions = {
  reportComment: (form: CreateCommentReport) => Promise<CommentReportResponse>;
  createComment: (form: CreateComment) => Promise<CommentResponse>;
  editComment: (form: EditComment) => Promise<CommentResponse>;
  voteComment: (form: CreateCommentLike) => Promise<CommentResponse>;
  getCommentVotes: (
    form: ListCommentLikes
  ) => Promise<ListCommentLikesResponse>;
  distinguishComment: (form: DistinguishComment) => Promise<CommentResponse>;
  reportPost: (form: CreatePostReport) => Promise<PostReportResponse>;
  votePost: (form: CreatePostLike) => Promise<PostResponse>;
  createPost: (form: CreatePost) => Promise<PostResponse>;
  editPost: (form: EditPost) => Promise<PostResponse>;
  getPostVotes: (form: ListPostLikes) => Promise<ListPostLikesResponse>;
  banFromCommunity: (
    form: BanFromCommunity
  ) => Promise<BanFromCommunityResponse>;
  banFromSite: (form: BanPerson) => Promise<BanPersonResponse>;
  sendPrivateMessage: (
    form: CreatePrivateMessage
  ) => Promise<PrivateMessageResponse>;
  reportPrivateMessage: (
    form: CreatePrivateMessageReport
  ) => Promise<PrivateMessageReportResponse>;
  approveRegistrationApplication: (
    form: ApproveRegistrationApplication
  ) => Promise<RegistrationApplicationResponse>;
  removePost: (form: RemovePost) => Promise<PostResponse>;
  removeComment: (form: RemoveComment) => Promise<CommentResponse>;
  resolvePostReport: (form: ResolvePostReport) => Promise<PostReportResponse>;
  resolveCommentReport: (
    form: ResolveCommentReport
  ) => Promise<CommentReportResponse>;
  resolvePrivateMessageReport: (
    form: ResolvePrivateMessageReport
  ) => Promise<PrivateMessageReportResponse>;
  featurePost: (form: FeaturePost) => Promise<PostResponse>;
  lockPost: (form: LockPost) => Promise<PostResponse>;
  getCommunity: (form: GetCommunity) => Promise<GetCommunityResponse>;
  followCommunity: (form: FollowCommunity) => Promise<CommunityResponse>;
  getPersonDetails: (
    form: GetPersonDetails
  ) => Promise<GetPersonDetailsResponse>;
  uploadImage: (image: Buffer) => Promise<UploadImageResponse>;
  getPost: (form: GetPost) => Promise<GetPostResponse>;
  getComment: (commentId: GetComment) => Promise<CommentResponse>;
  getParentOfComment: (form: Comment) => Promise<ParentResponse>;
  isCommunityMod: (form: {
    person: Person;
    community: Community;
  }) => Promise<boolean>;
  resolveObject: (form: ResolveObject) => Promise<ResolveObjectResponse>;
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
    __httpClient__: LemmyHttp;
  } & T
) => Promise<void> | void;

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

export type BotCredentials = {
  username: string;
  password: string;
};
