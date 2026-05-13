import {
  CreateCommentReport,
  CommentReportResponse,
  CreateComment,
  CommentResponse,
  EditComment,
  CreateCommentLike,
  ListCommentLikes,
  ListCommentLikesResponse,
  DistinguishComment,
  CreatePostReport,
  PostReportResponse,
  CreatePostLike,
  PostResponse,
  CreatePost,
  EditPost,
  ListPostLikes,
  ListPostLikesResponse,
  BanFromCommunity,
  BanFromCommunityResponse,
  BanPerson,
  BanPersonResponse,
  CreatePrivateMessage,
  PrivateMessageResponse,
  CreatePrivateMessageReport,
  PrivateMessageReportResponse,
  ApproveRegistrationApplication,
  RegistrationApplicationResponse,
  RemovePost,
  RemoveComment,
  ResolvePostReport,
  ResolveCommentReport,
  ResolvePrivateMessageReport,
  FeaturePost,
  LockPost,
  GetCommunity,
  GetCommunityResponse,
  FollowCommunity,
  CommunityResponse,
  GetPersonDetails,
  GetPersonDetailsResponse,
  UploadImageResponse,
  GetPost,
  GetPostResponse,
  GetComment,
  Person,
  Community,
  ResolveObject,
  ResolveObjectResponse,
  ListMedia,
  ListMediaResponse,
  HidePost,
  SuccessResponse
} from 'lemmy-js-client';
import { ParentResponse } from './ParentResponse';

export type BotActions = {
  reportComment: (form: CreateCommentReport) => Promise<CommentReportResponse>;
  createComment: (form: CreateComment) => Promise<CommentResponse>;
  editComment: (form: EditComment) => Promise<CommentResponse>;
  voteComment: (form: CreateCommentLike) => Promise<CommentResponse>;
  getCommentVotes: (
    form: ListCommentLikes
  ) => Promise<ListCommentLikesResponse>;
  distinguishComment: (form: DistinguishComment) => Promise<CommentResponse>;
  reportPost: (form: CreatePostReport) => Promise<PostReportResponse>;
  votePost: (form: CreatePostLike) => Promise<PostResponse>;
  createPost: (form: CreatePost) => Promise<PostResponse>;
  editPost: (form: EditPost) => Promise<PostResponse>;
  getPostVotes: (form: ListPostLikes) => Promise<ListPostLikesResponse>;
  banFromCommunity: (
    form: BanFromCommunity
  ) => Promise<BanFromCommunityResponse>;
  banFromSite: (form: BanPerson) => Promise<BanPersonResponse>;
  sendPrivateMessage: (
    form: CreatePrivateMessage
  ) => Promise<PrivateMessageResponse>;
  reportPrivateMessage: (
    form: CreatePrivateMessageReport
  ) => Promise<PrivateMessageReportResponse>;
  approveRegistrationApplication: (
    form: ApproveRegistrationApplication
  ) => Promise<RegistrationApplicationResponse>;
  removePost: (form: RemovePost) => Promise<PostResponse>;
  removeComment: (form: RemoveComment) => Promise<CommentResponse>;
  resolvePostReport: (form: ResolvePostReport) => Promise<PostReportResponse>;
  resolveCommentReport: (
    form: ResolveCommentReport
  ) => Promise<CommentReportResponse>;
  resolvePrivateMessageReport: (
    form: ResolvePrivateMessageReport
  ) => Promise<PrivateMessageReportResponse>;
  featurePost: (form: FeaturePost) => Promise<PostResponse>;
  lockPost: (form: LockPost) => Promise<PostResponse>;
  getCommunity: (form: GetCommunity) => Promise<GetCommunityResponse>;
  followCommunity: (form: FollowCommunity) => Promise<CommunityResponse>;
  getPersonDetails: (
    form: GetPersonDetails
  ) => Promise<GetPersonDetailsResponse>;
  uploadImage: (image: Buffer) => Promise<UploadImageResponse>;
  getPost: (form: GetPost) => Promise<GetPostResponse>;
  getComment: (commentId: GetComment) => Promise<CommentResponse>;
  getParentOfComment: (form: Comment) => Promise<ParentResponse>;
  isCommunityMod: (form: {
    person: Person;
    community: Community;
  }) => Promise<boolean>;
  resolveObject: (form: ResolveObject) => Promise<ResolveObjectResponse>;
  listMedia: (form?: ListMedia) => Promise<ListMediaResponse>;
  listAllMedia: (form?: ListMedia) => Promise<ListMediaResponse>;
  hidePost: (form: HidePost) => Promise<SuccessResponse>;
};
