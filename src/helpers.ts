import { ListingType } from 'lemmy-js-client';
import { StorageInfo } from './db';
import {
  BotFederationOptions,
  BotHandlers,
  BotInstanceFederationOptions,
  BotInstanceList,
  Vote,
  InternalHandlers
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

export const parseHandlers = (handlers?: BotHandlers) =>
  handlers
    ? Object.entries(handlers).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: typeof val === 'function' ? { handle: val } : val
        }),
        {} as InternalHandlers
      )
    : ({} as InternalHandlers);

export const getListingType = (options: BotFederationOptions): ListingType => {
  if ((options.allowList?.length ?? 0) === 1) {
    return 'Local';
  } else if (options.allowList?.every((i) => typeof i !== 'string')) {
    return 'Subscribed';
  } else {
    return 'All';
  }
};

export function removeItem<T>(items: T[], itemPredicate: (item: T) => boolean) {
  for (let i = 0; i < items.length; ++i) {
    if (itemPredicate(items[i])) {
      items.splice(i, 1);
      break;
    }
  }
}

export const stripPort = (instance: string) => instance.replace(/:.*/, '');

const escapeRegexString = (str: string) => stripPort(str.replace(/\./g, '\\.'));

const formatActorId = (instance: string, community: string) =>
  `https?://${instance}/c/(${community})`;

export const extractInstanceFromActorId = (actorId: string) =>
  actorId.match(/https?:\/\/(.*)\/(?:c|u)\/.*/)![1];

export const getInstanceRegex = (instances: BotInstanceList) => {
  const stringInstances: string[] = [],
    objectInstances: BotInstanceFederationOptions[] = [];

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
