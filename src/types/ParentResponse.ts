import { CommentResponse, GetPostResponse } from 'lemmy-js-client';

type ParentPost = {
  type: 'post';
  post: GetPostResponse;
};

type ParentComment = {
  type: 'comment';
  comment: CommentResponse;
};

export type ParentResponse = ParentPost | ParentComment;
