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
  ModRemoveCommunityView,
  ModBanFromCommunityView,
  ModAddCommunityView,
  ModTransferCommunityView,
  ModAddView,
  ModBanView,
  ListingType
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
  comment?: HandlerOptions<{ commentView: CommentView }>;
  post?: HandlerOptions<{ postView: PostView }>;
  privateMessage?: HandlerOptions<{ messageView: PrivateMessageView }>;
  registrationApplication?: HandlerOptions<{
    applicationView: RegistrationApplicationView;
  }>;
  mention?: HandlerOptions<{ mentionView: PersonMentionView }>;
  reply?: HandlerOptions<{ replyView: CommentReplyView }>;
  commentReport?: HandlerOptions<{ reportView: CommentReportView }>;
  postReport?: HandlerOptions<{ reportView: PostReportView }>;
  privateMessageReport?: HandlerOptions<{
    reportView: PrivateMessageReportView;
  }>;
  modRemovePost?: HandlerOptions<{ removedPostView: ModRemovePostView }>;
  modLockPost?: HandlerOptions<{ lockedPostView: ModLockPostView }>;
  modFeaturePost?: HandlerOptions<{ featuredPostView: ModFeaturePostView }>;
  modRemoveComment?: HandlerOptions<{
    removedCommentView: ModRemoveCommentView;
  }>;
  modRemoveCommunity?: HandlerOptions<{
    removedCommunityView: ModRemoveCommunityView;
  }>;
  modBanFromCommunity?: HandlerOptions<{ banView: ModBanFromCommunityView }>;
  modAddModToCommunity?: HandlerOptions<{
    modAddedToCommunityView: ModAddCommunityView;
  }>;
  modTransferCommunity?: HandlerOptions<{
    modTransferredToCommunityView: ModTransferCommunityView;
  }>;
  modAddAdmin?: HandlerOptions<{ addedAdminView: ModAddView }>;
  modBanFromSite?: HandlerOptions<{ banView: ModBanView }>;
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

type InstanceList = (string | InstanceFederationOptions)[];

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

export const getListingType = (options: BotFederationOptions) => {
  if ((options.allowList?.length ?? 0) === 1) {
    return ListingType.Local;
  } else {
    return ListingType.All;
  }
};

const escapeRegexString = (str: string) => str.replace(/\./g, '\\.');

const formatActorId = (instance: string, community: string) =>
  `https?://${instance}/c/(${community})`;

let instanceRegex: RegExp | undefined = undefined;

export const getInstanceRegex = (instances: InstanceList) => {
  if (!instanceRegex) {
    const stringInstances: string[] = [],
      objectInstances: InstanceFederationOptions[] = [];

    for (const instance of instances) {
      if (typeof instance === 'string') {
        stringInstances.push(escapeRegexString(instance));
      } else {
        objectInstances.push(instance);
      }
    }

    const regexParts = [];

    if (stringInstances.length > 0) {
      regexParts.push(`^${formatActorId(stringInstances.join('|'), '.*')}$`);
    }

    if (objectInstances.length > 0) {
      regexParts.push(
        `(${objectInstances
          .map(
            ({ instance, communities }) =>
              `^${formatActorId(
                escapeRegexString(instance),
                communities.join('|')
              )}$`
          )
          .join('|')})`
      );
    }

    instanceRegex = new RegExp(regexParts.join('|'));
  }

  return instanceRegex;
};
