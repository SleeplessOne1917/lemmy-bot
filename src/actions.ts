import { CommentSortType, SortType } from 'lemmy-js-client';
import { LemmyWebsocket } from 'lemmy-js-client';
import { connection as Connection } from 'websocket';
import { useDatabaseFunctions } from './db';
import { Vote } from './helpers';

const lemmyWSClient = new LemmyWebsocket();

export const logIn = (
  connection: Connection,
  username: string,
  password: string
) => {
  const loginRequest = lemmyWSClient.login({
    username_or_email: username,
    password,
  });

  connection.send(loginRequest);
};

export const voteDBPost = async ({
  connection,
  id,
  auth,
  vote,
}: {
  connection: Connection;
  id: number;
  auth: string;
  vote: Vote;
}) => {
  await useDatabaseFunctions(async ({ setPostVote }) => {
    const upvotePostRequest = lemmyWSClient.likePost({
      auth,
      post_id: id,
      score: vote,
    });

    setPostVote(id, vote);

    connection.send(upvotePostRequest);
  });
};

export const getPosts = (connection: Connection) => {
  const getPostsRequest = lemmyWSClient.getPosts({
    sort: SortType.New,
    limit: 10,
  });

  connection.send(getPostsRequest);
};

export const createPostReport = async ({
  connection,
  auth,
  id,
  reason,
}: {
  connection: Connection;
  auth: string;
  id: number;
  reason: string;
}) => {
  await useDatabaseFunctions(async ({ addPostReport }) => {
    const createPostReportRequest = lemmyWSClient.createPostReport({
      auth,
      post_id: id,
      reason,
    });

    await addPostReport(id);

    connection.send(createPostReportRequest);
  });
};

export const getComments = (connection: Connection) => {
  const getCommentsRequest = lemmyWSClient.getComments({
    sort: CommentSortType.New,
    limit: 10,
  });

  connection.send(getCommentsRequest);
};

export const createComment = async ({
  connection,
  auth,
  postId,
  parentId,
  content,
}: {
  connection: Connection;
  auth: string;
  postId: number;
  parentId?: number;
  content: string;
}) => {
  await useDatabaseFunctions(
    async ({ addCommentResponse, addPostResponse }) => {
      const createCommentRequest = lemmyWSClient.createComment({
        auth,
        content,
        post_id: postId,
        parent_id: parentId,
      });

      if (parentId) {
        await addCommentResponse(parentId);
      } else {
        await addPostResponse(postId);
      }

      connection.send(createCommentRequest);
    }
  );
};

export const createCommentReport = async ({
  auth,
  id,
  reason,
  connection,
}: {
  auth: string;
  id: number;
  reason: string;
  connection: Connection;
}) => {
  await useDatabaseFunctions(async ({ addCommentReport }) => {
    const createCommentReportRequest = lemmyWSClient.createCommentReport({
      auth,
      comment_id: id,
      reason,
    });

    await addCommentReport(id);

    connection.send(createCommentReportRequest);
  });
};
