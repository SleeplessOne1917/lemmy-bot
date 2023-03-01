import { CommentSortType, SortType } from 'lemmy-js-client';
import { LemmyWebsocket } from 'lemmy-js-client';
import { connection as Connection } from 'websocket';
import { futureDaysToUnixTime, Vote } from './helpers';

const client = new LemmyWebsocket();

export const logIn = ({
  connection,
  username,
  password
}: {
  connection: Connection;
  username: string;
  password: string;
}) => {
  const request = client.login({
    username_or_email: username,
    password
  });

  connection.send(request);
};

export const enableBotAccount = ({
  connection,
  auth
}: {
  connection: Connection;
  auth: string;
}) => {
  const request = client.saveUserSettings({
    auth,
    bot_account: true
  });

  connection.send(request);
};

export const voteDBPost = ({
  connection,
  id,
  auth,
  vote
}: {
  connection: Connection;
  id: number;
  auth: string;
  vote: Vote;
}) => {
  const request = client.likePost({
    auth,
    post_id: id,
    score: vote
  });

  connection.send(request);
};

export const voteDBComment = ({
  connection,
  id,
  auth,
  vote
}: {
  connection: Connection;
  id: number;
  auth: string;
  vote: Vote;
}) => {
  const request = client.likeComment({
    auth,
    comment_id: id,
    score: vote
  });

  connection.send(request);
};

export const getPosts = (connection: Connection, auth: string) => {
  const request = client.getPosts({
    sort: SortType.New,
    limit: 10,
    auth
  });

  connection.send(request);
};

export const createPostReport = ({
  connection,
  auth,
  id,
  reason
}: {
  connection: Connection;
  auth: string;
  id: number;
  reason: string;
}) => {
  const request = client.createPostReport({
    auth,
    post_id: id,
    reason
  });

  connection.send(request);
};

export const getComments = (connection: Connection, auth: string) => {
  const request = client.getComments({
    sort: CommentSortType.New,
    limit: 10,
    auth
  });

  connection.send(request);
};

export const createComment = ({
  connection,
  auth,
  postId,
  parentId,
  content
}: {
  connection: Connection;
  auth: string;
  postId: number;
  parentId?: number;
  content: string;
}) => {
  const request = client.createComment({
    auth,
    content,
    post_id: postId,
    parent_id: parentId
  });

  connection.send(request);
};

export const createCommentReport = ({
  auth,
  id,
  reason,
  connection
}: {
  auth: string;
  id: number;
  reason: string;
  connection: Connection;
}) => {
  const request = client.createCommentReport({
    auth,
    comment_id: id,
    reason
  });

  connection.send(request);
};

export const createBanFromCommunity = ({
  communityId,
  auth,
  connection,
  personId,
  daysUntilExpires,
  reason,
  removeData
}: {
  connection: Connection;
  auth: string;
  communityId: number;
  personId: number;
  daysUntilExpires?: number;
  reason?: string;
  removeData?: boolean;
}) => {
  const request = client.banFromCommunity({
    auth,
    ban: true,
    community_id: communityId,
    person_id: personId,
    expires: futureDaysToUnixTime(daysUntilExpires),
    reason,
    remove_data: removeData
  });

  connection.send(request);
};

export const createBanFromSite = ({
  auth,
  connection,
  personId,
  daysUntilExpires,
  reason,
  removeData
}: {
  connection: Connection;
  auth: string;
  personId: number;
  daysUntilExpires?: number;
  reason?: string;
  removeData?: boolean;
}) => {
  const request = client.banPerson({
    auth,
    ban: true,
    person_id: personId,
    expires: futureDaysToUnixTime(daysUntilExpires),
    reason,
    remove_data: removeData
  });

  connection.send(request);
};

export const getPrivateMessages = (connection: Connection, auth: string) => {
  const request = client.getPrivateMessages({
    auth,
    limit: 50,
    unread_only: true
  });

  connection.send(request);
};

export const markPrivateMessageAsRead = ({
  auth,
  connection,
  id
}: {
  connection: Connection;
  auth: string;
  id: number;
}) => {
  const request = client.markPrivateMessageAsRead({
    auth,
    private_message_id: id,
    read: true
  });

  connection.send(request);
};

export const createPrivateMessage = ({
  connection,
  auth,
  recipientId,
  content
}: {
  connection: Connection;
  auth: string;
  recipientId: number;
  content: string;
}) => {
  const request = client.createPrivateMessage({
    auth,
    content,
    recipient_id: recipientId
  });

  connection.send(request);
};

export const createPrivateMessageReport = ({
  id,
  connection,
  auth,
  reason
}: {
  id: number;
  connection: Connection;
  auth: string;
  reason: string;
}) => {
  const request = client.createPrivateMessageReport({
    auth,
    private_message_id: id,
    reason
  });

  connection.send(request);
};

export const getRegistrationApplications = (
  connection: Connection,
  auth: string
) => {
  const request = client.listRegistrationApplications({
    unread_only: true,
    limit: 10,
    auth
  });

  connection.send(request);
};

export const createApplicationApproval = ({
  connection,
  auth,
  id,
  approve,
  denyReason
}: {
  connection: Connection;
  auth: string;
  id: number;
  approve: boolean;
  denyReason?: string;
}) => {
  const request = client.approveRegistrationApplication({
    approve,
    auth,
    id,
    deny_reason: denyReason
  });

  connection.send(request);
};
