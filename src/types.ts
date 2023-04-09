import {
  CreatePost,
  PostFeatureType,
  UploadImageResponse
} from 'lemmy-js-client';
import { InternalHandlers, InternalSearchOptions } from './helpers';

export type LemmyBotOptions = {
  credentials?: BotCredentials;
  instance: string;
  connection?: BotConnectionOptions;
  handlers?: Handlers;
  federation?: 'local' | 'all' | BotFederationOptions;
  schedule?: BotTask | BotTask[];
};

export type BotActions = {
  replyToComment: (options: {
    commentId: number;
    postId: number;
    content: string;
  }) => void;
  reportComment: (commentId: number, reason: string) => void;
  replyToPost: (postId: number, content: string) => void;
  reportPost: (postId: number, reason: string) => void;
  votePost: (postId: number, vote: Vote) => void;
  createPost: (form: Omit<CreatePost, 'auth'>) => void;
  voteComment: (commentId: number, vote: Vote) => void;
  banFromCommunity: (options: {
    communityId: number;
    personId: number;
    daysUntilExpires?: number;
    reason?: string;
    removeData?: boolean;
  }) => void;
  banFromSite: (options: {
    personId: number;
    daysUntilExpires?: number;
    reason?: string;
    removeData?: boolean;
  }) => void;
  sendPrivateMessage: (recipientId: number, content: string) => void;
  reportPrivateMessage: (messageId: number, reason: string) => void;
  approveRegistrationApplication: (applicationId: number) => void;
  rejectRegistrationApplication: (
    applicationId: number,
    denyReason?: string
  ) => void;
  removePost: (postId: number, reason?: string) => void;
  removeComment: (commentId: number, reason?: string) => void;
  resolvePostReport: (postReportId: number) => void;
  resolveCommentReport: (commentReportId: number) => void;
  resolvePrivateMessageReport: (privateMessageReportId: number) => void;
  featurePost: (options: {
    postId: number;
    featureType: PostFeatureType;
    featured: boolean;
  }) => void;
  lockPost: (postId: number, locked: boolean) => void;
  getCommunityId: (options: SearchOptions) => Promise<number | null>;
  getUserId: (options: SearchOptions) => Promise<number | null>;
  uploadImage: (image: Buffer) => Promise<UploadImageResponse>;
};

type Handler<T> = (
  options: {
    botActions: BotActions;
    preventReprocess: () => void;
    reprocess: (minutes: number) => void;
  } & T
) => Promise<void>;

export type HandlerOptions<T> = {
  handle: Handler<T>;
  secondsBetweenPolls?: number;
  minutesUntilReprocess?: number;
};

export type Handlers = {
  [K in keyof InternalHandlers]?: InternalHandlers[K] extends
    | HandlerOptions<infer U>
    | undefined
    ? InternalHandlers[K] | Handler<U>
    : undefined;
};

export enum Vote {
  Upvote = 1,
  Downvote = -1,
  Neutral = 0
}

export type InstanceList = (string | InstanceFederationOptions)[];

export type BotFederationOptions = {
  allowList?: InstanceList;
  blockList?: InstanceList;
};

export type InstanceFederationOptions = {
  instance: string;
  communities: string[];
};

export type BotTask = {
  cronExpression: string;
  doTask: (botActions: BotActions) => Promise<void>;
  timezone?: string;
  runAtStart?: boolean;
};

export type BotConnectionOptions = {
  handleConnectionFailed?: (e: Error) => void;
  handleConnectionError?: (e: Error) => void;
  minutesBeforeRetryConnection?: number;
  secondsBetweenPolls?: number;
  minutesUntilReprocess?: number;
};

export type BotCredentials = {
  username: string;
  password: string;
};

export type SearchOptions = Omit<InternalSearchOptions, 'type'>;
