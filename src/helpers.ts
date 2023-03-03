import {
  CommentView,
  PostView,
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
  ModRemoveCommunityView
} from 'lemmy-js-client';
import { BotActions } from './bot';
import { StorageInfo } from './db';

export const getSecureWebsocketUrl = (instanceDomain: string) =>
  `wss://${instanceDomain}/api/v3/ws`;

export const getInsecureWebsocketUrl = (instanceDomain: string) =>
  `ws://${instanceDomain}/api/v3/ws`;

export enum Vote {
  Upvote = 1,
  Downvote = -1,
  Neutral = 0
}

export const correctVote = (vote: number): Vote => {
  if (vote < -1) {
    vote = Vote.Downvote;
  }

  if (vote > 1) {
    vote = Vote.Upvote;
  }

  return vote;
};

export const futureDaysToUnixTime = (days?: number) =>
  days
    ? Math.trunc(
        new Date(Date.now() + 1000 * 60 * 60 * 24 * days).getTime() / 1000
      )
    : undefined;

export const shouldProcess = ({ exists, reprocessTime }: StorageInfo) =>
  !exists || (reprocessTime && reprocessTime < new Date(Date.now()));

type Handler<T> = (
  options: {
    botActions: BotActions;
    preventReprocess: () => void;
    reprocess: (minutes: number) => void;
  } & T
) => void;

export type HandlerOptions<T> = {
  handle: Handler<T>;
  secondsBetweenPolls?: number;
  minutesUntilReprocess?: number;
};

type InternalHandlers = {
  comment?: HandlerOptions<{ comment: CommentView }>;
  post?: HandlerOptions<{ post: PostView }>;
  privateMessage?: HandlerOptions<{ message: PrivateMessageView }>;
  registrationApplication?: HandlerOptions<{
    application: RegistrationApplicationView;
  }>;
  mention?: HandlerOptions<{ mention: PersonMentionView }>;
  reply?: HandlerOptions<{ reply: CommentReplyView }>;
  commentReport?: HandlerOptions<{ report: CommentReportView }>;
  postReport?: HandlerOptions<{ report: PostReportView }>;
  privateMessageReport?: HandlerOptions<{ report: PrivateMessageReportView }>;
  modRemovePost?: HandlerOptions<{ removedPost: ModRemovePostView }>;
  modLockPost?: HandlerOptions<{ lockedPost: ModLockPostView }>;
  modFeaturePost?: HandlerOptions<{ featuredPost: ModFeaturePostView }>;
  modRemoveComment?: HandlerOptions<{ removedComment: ModRemoveCommentView }>;
  modRemoveCommunity?: HandlerOptions<{
    removedCommunity: ModRemoveCommunityView;
  }>;
};

export type Handlers = {
  [K in keyof InternalHandlers]?: InternalHandlers[K] extends
    | HandlerOptions<infer U>
    | undefined
    ? InternalHandlers[K] | Handler<U>
    : undefined;
};

export const parseHandlers = (handlers?: Handlers) =>
  handlers
    ? Object.entries(handlers).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: typeof val === 'function' ? { handle: val } : val
        }),
        {} as InternalHandlers
      )
    : ({} as InternalHandlers);
