import {
  PostView,
  CommentView,
  LemmyHttp,
  ListingType,
  ModlogActionType,
  ApproveRegistrationApplication
} from 'lemmy-js-client';
import {
  correctVote,
  extractInstanceFromActorId,
  getListingType,
  parseHandlers,
  shouldProcess,
  stripPort
} from './helpers';
import {
  RowUpserter,
  setupDB,
  StorageInfoGetter,
  useDatabaseFunctions
} from './db';
import ReprocessHandler from './reprocessHandler';
import cron, { ScheduledTask } from 'node-cron';
import {
  BotActions,
  BotFederationOptions,
  BotHandlerOptions,
  BotInstanceFederationOptions,
  BotOptions,
  SearchOptions,
  Vote,
  BotCredentials,
  InternalHandlers,
  BotInstanceList
} from './types';

const DEFAULT_SECONDS_BETWEEN_POLLS = 30;
const DEFAULT_MINUTES_UNTIL_REPROCESS: number | undefined = undefined;

class LemmyBot {
  #isDryRun: boolean;
  #isRunning: boolean;
  #isLoggedIn = false;
  #instance: string;
  #timeouts: NodeJS.Timeout[] = [];
  #markAsBot: boolean;
  #enableLogs: boolean;
  #defaultMinutesUntilReprocess?: number;
  #federationOptions: BotFederationOptions;
  #tasks: ScheduledTask[] = [];
  #delayedTasks: (() => Promise<void>)[] = [];
  __httpClient__: LemmyHttp;
  #dbFile?: string;
  #listingType: ListingType;
  #credentials?: BotCredentials;
  #defaultSecondsBetweenPolls = DEFAULT_SECONDS_BETWEEN_POLLS;
  #handlers: InternalHandlers;
  #federationOptionMaps = {
    allowMap: new Map<string, Set<number> | true>(),
    blockMap: new Map<string, Set<number> | true>()
  };
  #botActions: BotActions = {
    createPost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: 'Creating post',
        action: () => this.__httpClient__.createPost(form)
      }),
    editPost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Editing post ID ${form.post_id}`,
        action: () =>
          this.__httpClient__.editPost({
            ...form
          })
      }),
    reportPost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting to post ID ${form.post_id} for ${form.reason}`,
        action: () => this.__httpClient__.createPostReport(form)
      }),
    votePost: (form) => {
      const score = correctVote(form.score);
      const prefix =
        score === Vote.Upvote ? 'Up' : score === Vote.Downvote ? 'Down' : 'Un';

      return this.#performLoggedInBotAction({
        logMessage: `${prefix}voting post ID $form.{post_id}`,
        action: () =>
          this.__httpClient__.likePost({
            score,
            ...form
          })
      });
    },
    createComment: (form) =>
      this.#performLoggedInBotAction({
        logMessage: form.parent_id
          ? `Replying to comment ID ${form.parent_id}`
          : `Replying to post ID ${form.post_id}`,
        action: () => this.__httpClient__.createComment(form)
      }),
    editComment: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Editing comment ID ${form.comment_id}`,
        action: () => this.__httpClient__.editComment(form)
      }),
    reportComment: (form) =>
      this.#performLoggedInBotAction({
        action: () => this.__httpClient__.createCommentReport(form),
        logMessage: `Reporting to comment ID ${form.comment_id} for ${form.reason}`
      }),
    voteComment: async (form) => {
      const score = correctVote(form.score);
      const prefix =
        score === Vote.Upvote ? 'Up' : score === Vote.Downvote ? 'Down' : 'Un';

      return await this.#performLoggedInBotAction({
        logMessage: `${prefix}voting comment ID ${form.comment_id}`,
        action: () =>
          this.__httpClient__.likeComment({
            score,
            ...form
          })
      });
    },
    banFromCommunity: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${form.person_id} from ${form.community_id}`,
        action: () => this.__httpClient__.banFromCommunity(form)
      }),
    banFromSite: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${form.person_id} from ${this.#instance}`,
        action: () => this.__httpClient__.banPerson(form)
      }),
    sendPrivateMessage: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Sending private message to user ID ${form.recipient_id}`,
        action: () => this.__httpClient__.createPrivateMessage(form)
      }),
    reportPrivateMessage: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting private message ID ${form.private_message_id}. Reason: ${form.reason}`,
        action: () => this.__httpClient__.createPrivateMessageReport(form)
      }),
    approveRegistrationApplication: (form: ApproveRegistrationApplication) =>
      this.#performLoggedInBotAction({
        logMessage: `Approving application ID ${form.id}`,
        action: () => this.__httpClient__.approveRegistrationApplication(form)
      }),
    removePost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing post ID ${form.post_id}`,
        action: () => this.__httpClient__.removePost(form)
      }),
    removeComment: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing comment ID ${form.comment_id}`,
        action: () => this.__httpClient__.removeComment(form)
      }),
    resolvePostReport: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving post report ID ${form.report_id}`,
        action: () => this.__httpClient__.resolvePostReport(form)
      }),
    resolveCommentReport: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving comment report ID ${form.report_id}`,
        action: () => this.__httpClient__.resolveCommentReport(form)
      }),
    resolvePrivateMessageReport: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving private message report ID ${form.report_id}`,
        action: () => this.__httpClient__.resolvePrivateMessageReport(form)
      }),
    featurePost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `${form.featured ? 'F' : 'Unf'}eaturing report ID ${form.post_id}`,
        action: () => this.__httpClient__.featurePost(form)
      }),
    lockPost: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `${form.locked ? 'L' : 'Unl'}ocking report ID ${form.post_id}`,
        action: () => this.__httpClient__.lockPost(form)
      }),
    followCommunity: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Following community ID ${form.community_id}`,
        action: () => this.__httpClient__.followCommunity(form)
      }),
    uploadImage: (image) =>
      this.#performLoggedInBotAction({
        logMessage: 'Uploading image',
        action: () => this.__httpClient__.uploadImage({ image })
      }),
    getPost: this.__httpClient__.getPost,
    getComment: this.__httpClient__.getComment,
    getParentOfComment: async ({ path, post_id }) => {
      const pathList = path.split('.').filter((i) => i !== '0');

      if (pathList.length === 1) {
        return {
          type: 'post',
          data: await this.#botActions.getPost({
            id: post_id
          })
        };
      } else {
        const parentId = Number(pathList[pathList.length - 2]);

        return {
          type: 'comment',
          data: await this.#botActions.getComment({ id: parentId })
        };
      }
    },
    isCommunityMod: async ({ community, person }) => {
      const { moderates } = await this.__httpClient__.getPersonDetails({
        person_id: person.id
      });

      return moderates.some((comm) => comm.community.id === community.id);
    },
    resolveObject: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving object: ${form.q}`,
        action: () => this.__httpClient__.resolveObject(form)
      })
  };

  constructor({
    instance,
    credentials,
    handlers,
    connection: {
      minutesUntilReprocess:
        defaultMinutesUntilReprocess = DEFAULT_MINUTES_UNTIL_REPROCESS,
      secondsBetweenPolls:
        defaultSecondsBetweenPolls = DEFAULT_SECONDS_BETWEEN_POLLS
    } = {
      secondsBetweenPolls: DEFAULT_SECONDS_BETWEEN_POLLS,
      minutesUntilReprocess: DEFAULT_MINUTES_UNTIL_REPROCESS
    },
    dbFile,
    federation,
    schedule,
    markAsBot = true,
    enableLogs = true,
    dryRun = false
  }: BotOptions) {
    switch (federation) {
      case undefined:
      case 'local': {
        this.#federationOptions = {
          allowList: [stripPort(instance)]
        };

        break;
      }
      case 'all': {
        this.#federationOptions = {
          blockList: []
        };

        break;
      }

      default: {
        if (
          (federation.allowList?.length ?? 0) > 0 &&
          (federation.blockList?.length ?? 0) > 0
        ) {
          throw 'Cannot have both block list and allow list defined for federation options';
        } else if (
          (!federation.allowList || federation.allowList.length === 0) &&
          (!federation.blockList || federation.blockList.length === 0)
        ) {
          throw 'Neither the block list nor allow list has any instances. To fix this issue, make sure either allow list or block list (not both) has at least one instance.\n\nAlternatively, the you can set the federation property to one of the strings "local" or "all".';
        } else if (federation.blockList?.includes(instance)) {
          throw 'Cannot put bot instance in blocklist unless blocking specific communities';
        } else {
          this.#federationOptions = federation;

          if (
            this.#federationOptions.allowList &&
            !this.#federationOptions.allowList.some(
              (i) =>
                i === stripPort(instance) ||
                (i as BotInstanceFederationOptions).instance ===
                  stripPort(instance)
            )
          ) {
            this.#federationOptions.allowList.push(stripPort(instance));
          }
        }
      }
    }

    if (schedule) {
      const tasks = Array.isArray(schedule) ? schedule : [schedule];

      for (const task of tasks) {
        if (!cron.validate(task.cronExpression)) {
          throw `Schedule has invalid cron expression (${task.cronExpression}). Consult this documentation for valid expressions: https://www.gnu.org/software/mcron/manual/html_node/Crontab-file.html`;
        }

        this.#tasks.push(
          cron.schedule(
            task.cronExpression,
            () =>
              task.doTask({
                botActions: this.#botActions,
                __httpClient__: this.__httpClient__
              }),
            task.timezone || task.runAtStart
              ? {
                  ...(task.timezone ? { timezone: task.timezone } : {}),
                  ...(task.runAtStart ? { runOnInit: task.runAtStart } : {})
                }
              : undefined
          )
        );
      }
    }

    this.#credentials = credentials;
    this.#defaultSecondsBetweenPolls = defaultSecondsBetweenPolls;
    this.#isDryRun = dryRun;
    this.#isRunning = false;
    this.#markAsBot = markAsBot;
    this.#enableLogs = enableLogs;
    this.#instance = instance;
    this.#defaultMinutesUntilReprocess = defaultMinutesUntilReprocess;
    this.__httpClient__ = new LemmyHttp(
      `http${this.#instance.includes('localhost') ? '' : 's'}://${
        this.#instance
      }`
    );
    this.#dbFile = dbFile;
    this.#listingType = getListingType(this.#federationOptions);

    this.#handlers = parseHandlers(handlers);
  }

  async #runChecker(
    checker: () => void,
    secondsBetweenPolls: number = this.#defaultSecondsBetweenPolls
  ) {
    if (this.#isRunning) {
      if (this.#isLoggedIn || !this.#credentials) {
        checker();
        const timeout = setTimeout(
          () => {
            this.#runChecker(checker, secondsBetweenPolls);
            this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
          },
          1000 *
            (secondsBetweenPolls < DEFAULT_SECONDS_BETWEEN_POLLS
              ? DEFAULT_SECONDS_BETWEEN_POLLS
              : secondsBetweenPolls)
        );

        this.#timeouts.push(timeout);
      } else if (this.#credentials) {
        await this.#login();

        const timeout = setTimeout(() => {
          this.#runChecker(checker, secondsBetweenPolls);
          this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
        }, 5000);

        this.#timeouts.push(timeout);
      }
    } else {
      while (this.#timeouts.length > 0) {
        clearTimeout(this.#timeouts.pop());
      }
    }
  }

  async #runBot() {
    const {
      comment: commentOptions,
      post: postOptions,
      privateMessage: privateMessageOptions,
      registrationApplication: registrationApplicationOptions,
      mention: mentionOptions,
      reply: replyOptions,
      commentReport: commentReportOptions,
      postReport: postReportOptions,
      privateMessageReport: privateMessageReportOptions,
      modRemovePost: modRemovePostOptions,
      modLockPost: modLockPostOptions,
      modFeaturePost: modFeaturePostOptions,
      modRemoveComment: modRemoveCommentOptions,
      modRemoveCommunity: modRemoveCommunityOptions,
      modBanFromCommunity: modBanFromCommunityOptions,
      modAddModToCommunity: modAddModToCommunityOptions,
      modTransferCommunity: modTransferCommunityOptions,
      modAddAdmin: modAddAdminOptions,
      modBanFromSite: modBanFromSiteOptions
    } = this.#handlers;

    await setupDB(this.#log, this.#dbFile);

    if (this.#credentials) {
      await this.#login();
    }

    const subList = this.#federationOptions.allowList?.filter(
      (option) => typeof option !== 'string'
    ) as BotInstanceFederationOptions[] | undefined;

    if (
      subList &&
      subList.length === this.#federationOptions.allowList?.length
    ) {
      this.#listingType = 'Subscribed';
      await Promise.all(
        subList.flatMap(({ communities, instance }) =>
          communities.map((name) =>
            this.#botActions
              .getCommunityId({
                instance,
                name
              })
              .then((community_id) => {
                if (community_id) {
                  return this.__httpClient__.followCommunity({
                    community_id,
                    follow: true
                  });
                }
              })
              .catch(() =>
                console.log(`Could not subscribe to !${name}@${instance}`)
              )
          )
        )
      );
    }

    if (this.#delayedTasks.length > 0) {
      await Promise.all(this.#delayedTasks);
    }

    for (const task of this.#tasks) {
      task.start();
    }

    await this.#getCommunityIdsForAllowList();

    if (postOptions) {
      this.#runChecker(async () => {
        const response = await this.__httpClient__.getPosts({
          type_: this.#listingType,
          sort: postOptions.sort
        });

        const posts = this.#filterFromResponse(response.posts);

        await useDatabaseFunctions(
          'posts',
          async ({ get, upsert }) => {
            await Promise.all(
              posts.map((postView) =>
                this.#handleEntry({
                  getStorageInfo: get,
                  upsert,
                  entry: { postView },
                  id: postView.post.id,
                  options: postOptions
                })
              )
            );
          },
          this.#dbFile
        );
      }, postOptions.secondsBetweenPolls);
    }

    if (commentOptions) {
      this.#runChecker(async () => {
        const response = await this.__httpClient__.getComments({
          type_: this.#listingType,
          sort: commentOptions.sort
        });

        const comments = this.#filterFromResponse(response.comments);

        await useDatabaseFunctions(
          'comments',
          async ({ get, upsert }) => {
            await Promise.all(
              comments.map((commentView) =>
                this.#handleEntry({
                  getStorageInfo: get,
                  upsert,
                  options: commentOptions,
                  entry: { commentView },
                  id: commentView.comment.id
                })
              )
            );
          },
          this.#dbFile
        );
      }, commentOptions.secondsBetweenPolls);
    }

    if (privateMessageOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { private_messages } =
          await this.__httpClient__.getPrivateMessages({
            limit: 50,
            unread_only: true
          });

        await useDatabaseFunctions(
          'messages',
          async ({ get, upsert }) => {
            await Promise.all(
              private_messages.map(async (messageView) =>
                Promise.all([
                  this.#handleEntry({
                    getStorageInfo: get,
                    options: privateMessageOptions,
                    entry: { messageView },
                    id: messageView.private_message.id,
                    upsert
                  }),
                  this.#performLoggedInBotAction({
                    action: () =>
                      this.__httpClient__.markPrivateMessageAsRead({
                        private_message_id: messageView.private_message.id,
                        read: true
                      }),
                    logMessage: `Marked private message ID ${messageView.private_message.id} from ${messageView.creator.id} as read`
                  })
                ])
              )
            );
          },
          this.#dbFile
        );
      }, privateMessageOptions.secondsBetweenPolls);
    }

    if (registrationApplicationOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { registration_applications } =
          await this.__httpClient__.listRegistrationApplications({
            unread_only: true,
            limit: 50
          });

        await useDatabaseFunctions(
          'registrations',
          async ({ get, upsert }) => {
            await Promise.all(
              registration_applications.map((applicationView) =>
                this.#handleEntry({
                  getStorageInfo: get,
                  upsert,
                  entry: { applicationView },
                  id: applicationView.registration_application.id,
                  options: registrationApplicationOptions
                })
              )
            );
          },
          this.#dbFile
        );
      }, registrationApplicationOptions.secondsBetweenPolls);
    }

    if (mentionOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { mentions } = await this.__httpClient__.getPersonMentions({
          limit: 50,
          unread_only: true,
          sort: 'New'
        });

        await useDatabaseFunctions(
          'mentions',
          async ({ get, upsert }) => {
            await Promise.all(
              mentions.map((mentionView) =>
                Promise.all([
                  this.#handleEntry({
                    entry: { mentionView },
                    options: mentionOptions,
                    getStorageInfo: get,
                    id: mentionView.person_mention.id,
                    upsert
                  }),
                  this.#performLoggedInBotAction({
                    action: () =>
                      this.__httpClient__.markPersonMentionAsRead({
                        person_mention_id: mentionView.person_mention.id,
                        read: true
                      }),
                    logMessage: `Marked mention ${mentionView.person_mention.id} from ${mentionView.creator.id} as read`
                  })
                ])
              )
            );
          },
          this.#dbFile
        );
      }, mentionOptions.secondsBetweenPolls);
    }

    if (replyOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { replies } = await this.__httpClient__.getReplies({
          limit: 50,
          sort: 'New',
          unread_only: true
        });

        await useDatabaseFunctions(
          'replies',
          async ({ get, upsert }) => {
            await Promise.all(
              replies.map(async (replyView) =>
                Promise.all([
                  this.#handleEntry({
                    entry: { replyView },
                    options: replyOptions,
                    getStorageInfo: get,
                    id: replyView.comment_reply.id,
                    upsert
                  }),
                  this.#performLoggedInBotAction({
                    action: () =>
                      this.__httpClient__.markCommentReplyAsRead({
                        comment_reply_id: replyView.comment_reply.id,
                        read: true
                      }),
                    logMessage: `Marking reply ${replyView.comment_reply.id} from ${replyView.creator.id} as read`
                  })
                ])
              )
            );
          },
          this.#dbFile
        );
      }, replyOptions.secondsBetweenPolls);
    }

    if (commentReportOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { comment_reports } =
          await this.__httpClient__.listCommentReports({
            unresolved_only: true,
            limit: 50
          });

        await useDatabaseFunctions(
          'commentReports',
          async ({ get, upsert }) => {
            await Promise.all(
              comment_reports.map((reportView) =>
                this.#handleEntry({
                  entry: { reportView },
                  options: commentReportOptions,
                  getStorageInfo: get,
                  id: reportView.comment_report.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, commentReportOptions.secondsBetweenPolls);
    }

    if (postReportOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { post_reports } = await this.__httpClient__.listPostReports({
          unresolved_only: true,
          limit: 50
        });

        await useDatabaseFunctions(
          'postReports',
          async ({ get, upsert }) => {
            await Promise.all(
              post_reports.map((reportView) =>
                this.#handleEntry({
                  entry: { reportView },
                  options: postReportOptions,
                  getStorageInfo: get,
                  id: reportView.post_report.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, postReportOptions.secondsBetweenPolls);
    }

    if (privateMessageReportOptions && this.#credentials) {
      this.#runChecker(async () => {
        const { private_message_reports } =
          await this.__httpClient__.listPrivateMessageReports({
            limit: 50,
            unresolved_only: true
          });

        if (privateMessageReportOptions) {
          await useDatabaseFunctions(
            'messageReports',
            async ({ get, upsert }) => {
              await Promise.all(
                private_message_reports.map((reportView) =>
                  this.#handleEntry({
                    entry: { reportView },
                    options: privateMessageReportOptions,
                    getStorageInfo: get,
                    id: reportView.private_message_report.id,
                    upsert
                  })
                )
              );
            },
            this.#dbFile
          );
        }
      }, privateMessageReportOptions.secondsBetweenPolls);
    }

    if (modRemovePostOptions) {
      this.#runChecker(async () => {
        const { removed_posts } = await this.#getModlogItems('ModRemovePost');

        await useDatabaseFunctions(
          'removedPosts',
          async ({ get, upsert }) => {
            await Promise.all(
              removed_posts.map((removedPostView) =>
                this.#handleEntry({
                  entry: { removedPostView },
                  options: modRemovePostOptions,
                  getStorageInfo: get,
                  id: removedPostView.mod_remove_post.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modRemovePostOptions.secondsBetweenPolls);
    }

    if (modLockPostOptions) {
      this.#runChecker(async () => {
        const { locked_posts } = await this.#getModlogItems('ModLockPost');

        await useDatabaseFunctions(
          'lockedPosts',
          async ({ get, upsert }) => {
            await Promise.all(
              locked_posts.map((lockedPostView) =>
                this.#handleEntry({
                  entry: { lockedPostView },
                  options: modLockPostOptions,
                  getStorageInfo: get,
                  id: lockedPostView.mod_lock_post.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modLockPostOptions.secondsBetweenPolls);
    }

    if (modFeaturePostOptions) {
      this.#runChecker(async () => {
        const { featured_posts } = await this.#getModlogItems('ModFeaturePost');

        await useDatabaseFunctions(
          'featuredPosts',
          async ({ get, upsert }) => {
            await Promise.all(
              featured_posts.map((featuredPostView) =>
                this.#handleEntry({
                  entry: { featuredPostView },
                  options: modFeaturePostOptions,
                  getStorageInfo: get,
                  id: featuredPostView.mod_feature_post.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modFeaturePostOptions.secondsBetweenPolls);
    }

    if (modRemoveCommentOptions) {
      this.#runChecker(async () => {
        const { removed_comments } =
          await this.#getModlogItems('ModRemoveComment');

        await useDatabaseFunctions(
          'removedComments',
          async ({ get, upsert }) => {
            await Promise.all(
              removed_comments.map((removedCommentView) =>
                this.#handleEntry({
                  entry: { removedCommentView },
                  options: modRemoveCommentOptions,
                  getStorageInfo: get,
                  id: removedCommentView.mod_remove_comment.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modRemoveCommentOptions.secondsBetweenPolls);
    }

    if (modRemoveCommunityOptions) {
      this.#runChecker(async () => {
        const { removed_communities } =
          await this.#getModlogItems('ModRemoveCommunity');

        await useDatabaseFunctions(
          'removedCommunities',
          async ({ get, upsert }) => {
            await Promise.all(
              removed_communities.map((removedCommunityView) =>
                this.#handleEntry({
                  entry: { removedCommunityView },
                  options: modRemoveCommunityOptions,
                  getStorageInfo: get,
                  id: removedCommunityView.mod_remove_community.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modRemoveCommunityOptions.secondsBetweenPolls);
    }

    if (modBanFromCommunityOptions) {
      this.#runChecker(async () => {
        const { banned_from_community } = await this.#getModlogItems(
          'ModBanFromCommunity'
        );

        await useDatabaseFunctions(
          'communityBans',
          async ({ get, upsert }) => {
            await Promise.all(
              banned_from_community.map((banView) =>
                this.#handleEntry({
                  entry: { banView },
                  options: modBanFromCommunityOptions,
                  getStorageInfo: get,
                  id: banView.mod_ban_from_community.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modBanFromCommunityOptions.secondsBetweenPolls);
    }

    if (modAddModToCommunityOptions) {
      this.#runChecker(async () => {
        const { added_to_community } =
          await this.#getModlogItems('ModAddCommunity');
        await useDatabaseFunctions(
          'modsAddedToCommunities',
          async ({ get, upsert }) => {
            await Promise.all(
              added_to_community.map((modAddedToCommunityView) =>
                this.#handleEntry({
                  entry: { modAddedToCommunityView },
                  options: modAddModToCommunityOptions,
                  getStorageInfo: get,
                  id: modAddedToCommunityView.mod_add_community.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modAddModToCommunityOptions.secondsBetweenPolls);
    }

    if (modTransferCommunityOptions) {
      this.#runChecker(async () => {
        const { transferred_to_community } = await this.#getModlogItems(
          'ModTransferCommunity'
        );

        await useDatabaseFunctions(
          'modsTransferredToCommunities',
          async ({ get, upsert }) => {
            await Promise.all(
              transferred_to_community.map((modTransferredToCommunityView) =>
                this.#handleEntry({
                  entry: { modTransferredToCommunityView },
                  options: modTransferCommunityOptions,
                  getStorageInfo: get,
                  id: modTransferredToCommunityView.mod_transfer_community.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modTransferCommunityOptions.secondsBetweenPolls);
    }

    if (modAddAdminOptions) {
      this.#runChecker(async () => {
        const { added } = await this.#getModlogItems('ModAdd');

        await useDatabaseFunctions(
          'adminsAdded',
          async ({ get, upsert }) => {
            await Promise.all(
              added.map((addedAdminView) =>
                this.#handleEntry({
                  entry: { addedAdminView },
                  options: modAddAdminOptions,
                  getStorageInfo: get,
                  upsert,
                  id: addedAdminView.mod_add.id
                })
              )
            );
          },
          this.#dbFile
        );
      }, modAddAdminOptions.secondsBetweenPolls);
    }

    if (modBanFromSiteOptions) {
      this.#runChecker(async () => {
        const { banned } = await this.#getModlogItems('ModBan');

        await useDatabaseFunctions(
          'siteBans',
          async ({ get, upsert }) => {
            await Promise.all(
              banned.map((banView) =>
                this.#handleEntry({
                  entry: { banView },
                  options: modBanFromSiteOptions,
                  getStorageInfo: get,
                  id: banView.mod_ban.id,
                  upsert
                })
              )
            );
          },
          this.#dbFile
        );
      }, modBanFromSiteOptions.secondsBetweenPolls);
    }
  }

  start() {
    this.#log('Starting bot');
    this.#isRunning = true;
    this.#runBot();
  }

  stop() {
    this.#log('Stopping bot');
    this.#isRunning = false;
    this.#isLoggedIn = false;
  }

  async #login() {
    if (this.#credentials) {
      this.#log('Logging in');
      const loginRes = await this.__httpClient__.login({
        password: this.#credentials.password,
        username_or_email: this.#credentials.username
      });

      this.#log('Logged in');
      this.__httpClient__.setHeaders({
        Authorization: `Bearer ${loginRes.jwt}`
      });
      this.#isLoggedIn = true;

      if (this.#markAsBot) {
        this.#log('Marking account as bot account');

        await this.__httpClient__
          .saveUserSettings({
            bot_account: true
          })
          .catch(console.error);
      }
    }
  }

  async #getCommunityIdsForAllowList() {
    await Promise.all(
      this.#assignOptionsToMaps(
        this.#federationOptions.allowList,
        'allowMap'
      ).concat(
        this.#assignOptionsToMaps(this.#federationOptions.blockList, 'blockMap')
      )
    );
  }

  #assignOptionsToMaps(
    list: BotInstanceList | undefined,
    map: 'allowMap' | 'blockMap'
  ) {
    return (
      list?.map(async (instanceOptions) => {
        if (
          typeof instanceOptions === 'string' &&
          !this.#federationOptionMaps[map].get(instanceOptions)
        ) {
          this.#federationOptionMaps[map].set(instanceOptions, true);
        } else if (
          !this.#federationOptionMaps[map].get(
            (instanceOptions as BotInstanceFederationOptions).instance
          )
        ) {
          this.#federationOptionMaps[map].set(
            stripPort(
              (instanceOptions as BotInstanceFederationOptions).instance
            ),
            new Set(
              await Promise.all(
                (instanceOptions as BotInstanceFederationOptions).communities
                  .map((c) =>
                    this.#botActions
                      .getCommunityId({
                        instance: (
                          instanceOptions as BotInstanceFederationOptions
                        ).instance,
                        name: c
                      })
                      .catch(() =>
                        console.log(
                          `Could not get !${c}@${
                            (instanceOptions as BotInstanceFederationOptions)
                              .instance
                          }`
                        )
                      )
                  )
                  .filter((c) => c) as Promise<number>[]
              )
            )
          );
        }
      }) ?? []
    );
  }

  async #handleEntry<
    THandledItem,
    TOptions extends Record<string, any> = Record<string, never>
  >({
    getStorageInfo,
    upsert,
    options,
    id,
    entry
  }: {
    getStorageInfo: StorageInfoGetter;
    upsert: RowUpserter;
    options: BotHandlerOptions<THandledItem, TOptions>;
    id: number;
    entry: THandledItem;
  }) {
    const storageInfo = await getStorageInfo(id);
    if (shouldProcess(storageInfo)) {
      const { get, preventReprocess, reprocess } = new ReprocessHandler(
        options?.minutesUntilReprocess ?? this.#defaultMinutesUntilReprocess
      );

      await options!.handle!({
        botActions: this.#botActions,
        preventReprocess,
        reprocess,
        __httpClient__: this.__httpClient__,
        ...entry
      });

      await upsert(id, get());
    }
  }

  #filterFromResponse<T extends PostView | CommentView>(response: T[]) {
    if ((this.#federationOptions.allowList?.length ?? 0) > 0) {
      return response.filter(({ community: { actor_id, id } }) => {
        const instance = extractInstanceFromActorId(actor_id);

        return (
          this.#federationOptionMaps.allowMap.get(instance) === true ||
          (
            this.#federationOptionMaps.allowMap.get(instance) as
              | Set<number>
              | undefined
          )?.has(id)
        );
      });
    } else if ((this.#federationOptions.blockList?.length ?? 0) > 0) {
      return response.filter((d) => {
        const instance = extractInstanceFromActorId(d.community.actor_id);
        return !(
          this.#federationOptionMaps.blockMap.get(instance) === true ||
          (
            this.#federationOptionMaps.blockMap.get(instance) as
              | Set<number>
              | undefined
          )?.has(d.community.id)
        );
      });
    } else {
      return response;
    }
  }

  async #getId(form: SearchOptions | string, type: 'Users' | 'Communities') {
    let localOptions: SearchOptions;
    if (typeof form === 'string') {
      localOptions = {
        name: form,
        instance: this.#instance
      };
    } else {
      localOptions = form;
    }
    const instanceWithoutPort = stripPort(localOptions.instance);

    const { communities, users } = await this.__httpClient__.search({
      q: localOptions.name,
      type_: type
    });

    if (type === 'Communities') {
      return communities.find(({ community: { name, title, actor_id } }) => {
        let extractedInstance = '';
        try {
          extractedInstance = extractInstanceFromActorId(actor_id);
        } catch {
          console.log(
            `Could not find !${localOptions.name}@${localOptions.instance}`
          );
        }
        return (
          (name === localOptions.name || title === localOptions.name) &&
          extractedInstance === instanceWithoutPort
        );
      })?.community.id;
    } else {
      return users.find(
        ({ person: { name, display_name, actor_id } }) =>
          (name === localOptions.name || display_name === localOptions.name) &&
          extractInstanceFromActorId(actor_id) === instanceWithoutPort
      )?.person.id;
    }
  }

  #getModlogItems = (type: ModlogActionType) =>
    this.__httpClient__.getModlog({
      type_: type,
      limit: 50
    });

  async #performLoggedInBotAction<T>({
    logMessage,
    action
  }: {
    logMessage: string;
    action: () => Promise<T>;
  }): Promise<T> {
    this.#log(logMessage);

    if (this.#isDryRun) {
      return Promise.reject();
    }

    try {
      return await action();
    } catch (err: any) {
      if (err.error === 'not_logged_in') {
        this.#isLoggedIn = false;
      }

      throw err;
    }
  }

  #log = (output: string) => {
    if (this.#enableLogs) {
      console.log(output);
    }
  };
}

export default LemmyBot;
