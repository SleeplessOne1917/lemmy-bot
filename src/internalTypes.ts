import {
  CommentReplyView,
  CommentReportView,
  CommentView,
  ModAddCommunityView,
  ModAddView,
  ModBanFromCommunityView,
  ModBanView,
  ModFeaturePostView,
  ModLockPostView,
  ModRemoveCommentView,
  ModRemoveCommunityView,
  ModRemovePostView,
  ModTransferCommunityView,
  PersonMentionView,
  PostReportView,
  PostView,
  PrivateMessageReportView,
  PrivateMessageView,
  RegistrationApplicationView,
  SearchType
} from 'lemmy-js-client';
import { HandlerOptions } from './types';

export type InternalSearchOptions = {
  name: string;
  instance: string;
  type: SearchType.Communities | SearchType.Users;
};

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
