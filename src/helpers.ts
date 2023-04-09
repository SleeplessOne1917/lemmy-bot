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
  ListingType,
  SearchType
} from 'lemmy-js-client';
import { StorageInfo } from './db';
import {
  BotFederationOptions,
  HandlerOptions,
  Handlers,
  InstanceFederationOptions,
  InstanceList,
  Vote
} from './types';

export const getSecureWebsocketUrl = (instanceDomain: string) =>
  `wss://${instanceDomain}/api/v3/ws`;

export const getInsecureWebsocketUrl = (instanceDomain: string) =>
  `ws://${instanceDomain}/api/v3/ws`;

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

export type InternalHandlers = {
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

export const extractInstanceFromActorId = (actorId: string) =>
  actorId.match(/https?:\/\/(.*)\/(?:c|u)\/.*/)![1];

export const getInstanceRegex = (instances: InstanceList) => {
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

  return new RegExp(regexParts.join('|'));
};

export type InternalSearchOptions = {
  name: string;
  instance: string;
  type: SearchType.Communities | SearchType.Users;
};
