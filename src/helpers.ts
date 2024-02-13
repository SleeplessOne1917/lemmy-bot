import { ListingType } from 'lemmy-js-client';
import { StorageInfo } from './db';
import {
  BotFederationOptions,
  BotHandlers,
  Vote,
  InternalHandlers
} from './types';

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
  if (
    options.allowList &&
    options.allowList.length === 1 &&
    typeof options.allowList[0] === 'string'
  ) {
    return 'Local';
  } else {
    return 'All';
  }
};

export const extractInstanceFromActorId = (actorId: string) =>
  actorId.match(/https?:\/\/(.*)\/(?:c|u|m)\/.*/)![1];
