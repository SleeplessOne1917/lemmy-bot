import { ListingType } from 'lemmy-js-client';
import { StorageInfo } from './db';
import {
  BotFederationOptions,
  Handlers,
  InstanceFederationOptions,
  InstanceList,
  Vote
} from './types';
import { InternalHandlers } from './internalTypes';

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
