import { CommentSortType } from 'lemmy-js-client';
import { LemmyWebsocket } from 'lemmy-js-client';
import { connection as Connection } from 'websocket';
import { useDatabaseFunctions } from './db';

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

export const getComments = (connection: Connection) => {
  const getCommentsRequest = lemmyWSClient.getComments({
    sort: CommentSortType.New,
    limit: 10,
  });

  connection.send(getCommentsRequest);
};

export const createComment = ({
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
  useDatabaseFunctions(async ({ addComment, addPost }) => {
    const createCommentRequest = lemmyWSClient.createComment({
      auth,
      content,
      post_id: postId,
      parent_id: parentId,
    });

    if (parentId) {
      await addComment(parentId);
    } else {
      await addPost(postId);
    }

    connection.send(createCommentRequest);
  });
};