import {
  PostView,
  CommentView,
  LemmyHttp,
  ListingType,
  ModlogActionType
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
  #isRunning: boolean;
  #instance: string;
  #timeouts: NodeJS.Timeout[] = [];
  #auth?: string;
  #markAsBot: boolean;
  #defaultMinutesUntilReprocess?: number;
  #federationOptions: BotFederationOptions;
  #tasks: ScheduledTask[] = [];
  #delayedTasks: (() => Promise<void>)[] = [];
  #httpClient: LemmyHttp;
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
        action: () =>
          this.#httpClient.createPost({ ...form, auth: this.#auth ?? '' })
      }),
    reportPost: ({ post_id, reason }) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting to post ID ${post_id} for ${reason}`,
        action: () =>
          this.#httpClient.createPostReport({
            auth: this.#auth!,
            post_id,
            reason
          })
      }),
    votePost: async ({ post_id, vote }) => {
      const score = correctVote(vote);
      const prefix =
        vote === Vote.Upvote ? 'Up' : vote === Vote.Downvote ? 'Down' : 'Un';

      await this.#performLoggedInBotAction({
        logMessage: `${prefix}voting post ID ${post_id}`,
        action: () =>
          this.#httpClient.likePost({
            auth: this.#auth!,
            post_id,
            score
          })
      });
    },
    createComment: ({ parent_id, content, post_id, language_id }) =>
      this.#performLoggedInBotAction({
        logMessage: parent_id
          ? `Replying to comment ID ${parent_id}`
          : `Replying to post ID ${post_id}`,
        action: () =>
          this.#httpClient.createComment({
            auth: this.#auth!,
            content,
            post_id,
            parent_id,
            language_id
          })
      }),
    reportComment: ({ comment_id, reason }) =>
      this.#performLoggedInBotAction({
        action: () =>
          this.#httpClient.createCommentReport({
            auth: this.#auth!,
            comment_id,
            reason
          }),
        logMessage: `Reporting to comment ID ${comment_id} for ${reason}`
      }),
    voteComment: async ({ comment_id, vote }) => {
      const score = correctVote(vote);
      const prefix =
        score === Vote.Upvote ? 'Up' : score === Vote.Downvote ? 'Down' : 'Un';

      await this.#performLoggedInBotAction({
        logMessage: `${prefix}voting comment ID ${comment_id}`,
        action: () =>
          this.#httpClient.likeComment({
            auth: this.#auth!,
            comment_id,
            score
          })
      });
    },
    banFromCommunity: (form) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${form.person_id} from ${form.community_id}`,
        action: () =>
          this.#httpClient.banFromCommunity({
            ...form,
            auth: this.#auth!,
            ban: true
          })
      }),
    banFromSite: ({ person_id, days_until_expires, reason, remove_data }) =>
      this.#performLoggedInBotAction({
        logMessage: `Banning user ID ${person_id} from ${this.#instance}`,
        action: () =>
          this.#httpClient.banPerson({
            auth: this.#auth!,
            person_id,
            expires: days_until_expires,
            reason,
            remove_data,
            ban: true
          })
      }),
    sendPrivateMessage: ({ recipient_id, content }) =>
      this.#performLoggedInBotAction({
        logMessage: `Sending private message to user ID ${recipient_id}`,
        action: () =>
          this.#httpClient.createPrivateMessage({
            auth: this.#auth!,
            content,
            recipient_id
          })
      }),
    reportPrivateMessage: ({ private_message_id, reason }) =>
      this.#performLoggedInBotAction({
        logMessage: `Reporting private message ID ${private_message_id}. Reason: ${reason}`,
        action: () =>
          this.#httpClient.createPrivateMessageReport({
            auth: this.#auth!,
            private_message_id,
            reason
          })
      }),
    approveRegistrationApplication: (applicationId) =>
      this.#performLoggedInBotAction({
        logMessage: `Approving application ID ${applicationId}`,
        action: () =>
          this.#httpClient.approveRegistrationApplication({
            auth: this.#auth!,
            approve: true,
            id: applicationId
          })
      }),
    rejectRegistrationApplication: ({ id, deny_reason }) =>
      this.#performLoggedInBotAction({
        logMessage: `Rejecting application ID ${id}`,
        action: () =>
          this.#httpClient.approveRegistrationApplication({
            auth: this.#auth!,
            approve: false,
            id,
            deny_reason
          })
      }),
    removePost: ({ post_id, reason }) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing post ID ${post_id}`,
        action: () =>
          this.#httpClient.removePost({
            auth: this.#auth!,
            post_id,
            removed: true,
            reason
          })
      }),
    removeComment: ({ comment_id, reason }) =>
      this.#performLoggedInBotAction({
        logMessage: `Removing comment ID ${comment_id}`,
        action: () =>
          this.#httpClient.removeComment({
            auth: this.#auth!,
            comment_id,
            removed: true,
            reason
          })
      }),
    resolvePostReport: (report_id) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving post report ID ${report_id}`,
        action: () =>
          this.#httpClient.resolveCommentReport({
            auth: this.#auth!,
            report_id,
            resolved: true
          })
      }),
    resolveCommentReport: (report_id) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving comment report ID ${report_id}`,
        action: () =>
          this.#httpClient.resolveCommentReport({
            auth: this.#auth!,
            report_id,
            resolved: true
          })
      }),
    resolvePrivateMessageReport: (report_id) =>
      this.#performLoggedInBotAction({
        logMessage: `Resolving private message report ID ${report_id}`,
        action: () =>
          this.#httpClient.resolvePrivateMessageReport({
            auth: this.#auth!,
            report_id,
            resolved: true
          })
      }),
    featurePost: ({ feature_type, featured, post_id }) =>
      this.#performLoggedInBotAction({
        logMessage: `${featured ? 'F' : 'Unf'}eaturing report ID ${post_id}`,
        action: () =>
          this.#httpClient.featurePost({
            auth: this.#auth!,
            post_id,
            featured,
            feature_type
          })
      }),
    lockPost: ({ post_id, locked }) =>
      this.#performLoggedInBotAction({
        logMessage: `${locked ? 'L' : 'Unl'}ocking report ID ${post_id}`,
        action: () =>
          this.#httpClient.lockPost({
            auth: this.#auth!,
            post_id,
            locked
          })
      }),
    getCommunityId: (form) => this.#getId(form, 'Communities'),
    followCommunity: (community_id) =>
      this.#performLoggedInBotAction({
        logMessage: `Following community ID ${community_id}`,
        action: () =>
          this.#httpClient.followCommunity({
            auth: this.#auth!,
            community_id,
            follow: true
          })
      }),
    getUserId: (form) => this.#getId(form, 'Users'),
    uploadImage: (image) =>
      this.#httpClient.uploadImage({ image, auth: this.#auth }),
    getPost: async (postId) => {
      const { post_view } = await this.#httpClient.getPost({
        auth: this.#auth,
        id: postId
      });

      return post_view;
    },
    getComment: async (commentId) =>
      (await this.#httpClient.getComment({ id: commentId })).comment_view,
    getParentOfComment: async ({ path, post_id }) => {
      const pathList = path.split('.').filter((i) => i !== '0');

      if (pathList.length === 1) {
        return {
          type: 'post',
          data: await this.#botActions.getPost(post_id)
        };
      } else {
        const parentId = Number(pathList[pathList.length - 2]);

        return {
          type: 'comment',
          data: await this.#botActions.getComment(parentId)
        };
      }
    },
    isCommunityMod: async ({ community_id, person_id }) => {
      const { moderators } = await this.#httpClient.getCommunity({
        id: community_id
      });

      return moderators.some((mod) => mod.moderator.id === person_id);
    },
    resolveObject: (form) => {
      if (typeof form === 'string') {
        return this.#httpClient.resolveObject({ auth: this.#auth!, q: form });
      } else {
        const { communityName, instance } = form;

        return this.#httpClient.resolveObject({
          auth: this.#auth!,
          q: `!${communityName}@${instance}`
        });
      }
    }
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
    markAsBot = true
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
            () => task.doTask(this.#botActions),
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
    this.#isRunning = false;
    this.#markAsBot = markAsBot;
    this.#instance = instance;
    this.#defaultMinutesUntilReprocess = defaultMinutesUntilReprocess;
    this.#httpClient = new LemmyHttp(
      `http${this.#instance.includes('localhost') ? '' : 's'}://${
        this.#instance
      }`
    );
    this.#dbFile = dbFile;
    this.#listingType = getListingType(this.#federationOptions);

    this.#handlers = parseHandlers(handlers);
  }

  async #runChecker(
    checker: (auth?: string) => void,
    secondsBetweenPolls: number = this.#defaultSecondsBetweenPolls
  ) {
    if (this.#isRunning) {
      if (this.#auth || !this.#credentials) {
        checker(this.#auth);
        const timeout = setTimeout(() => {
          this.#runChecker(checker, secondsBetweenPolls);
          this.#timeouts = this.#timeouts.filter((t) => t !== timeout);
        }, 1000 * (secondsBetweenPolls < DEFAULT_SECONDS_BETWEEN_POLLS ? DEFAULT_SECONDS_BETWEEN_POLLS : secondsBetweenPolls));

        this.#timeouts.push(timeout);
      } else if (this.#credentials && !this.#auth) {
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

    await setupDB(this.#dbFile);

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
                  return this.#httpClient.followCommunity({
                    auth: this.#auth ?? '',
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
      this.#runChecker(async (auth) => {
        const response = await this.#httpClient.getPosts({
          type_: this.#listingType,
          auth,
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
      this.#runChecker(async (auth) => {
        const response = await this.#httpClient.getComments({
          auth,
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
      this.#runChecker(async (auth) => {
        const { private_messages } = await this.#httpClient.getPrivateMessages({
          auth: auth ?? '',
          limit: 50,
          unread_only: true
        });

        await useDatabaseFunctions(
          'messages',
          async ({ get, upsert }) => {
            await Promise.all(
              private_messages.map(async (messageView) => {
                const promise = this.#handleEntry({
                  getStorageInfo: get,
                  options: privateMessageOptions,
                  entry: { messageView },
                  id: messageView.private_message.id,
                  upsert
                });

                if (this.#auth) {
                  await this.#httpClient.markPrivateMessageAsRead({
                    auth: this.#auth,
                    private_message_id: messageView.private_message.id,
                    read: true
                  });

                  console.log(
                    `Marked private message ID ${messageView.private_message.id} from ${messageView.creator.id} as read`
                  );

                  return promise;
                }
              })
            );
          },
          this.#dbFile
        );
      }, privateMessageOptions.secondsBetweenPolls);
    }

    if (registrationApplicationOptions && this.#credentials) {
      this.#runChecker(async (auth) => {
        const { registration_applications } =
          await this.#httpClient.listRegistrationApplications({
            unread_only: true,
            limit: 50,
            auth: auth ?? ''
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
      this.#runChecker(async (auth) => {
        const { mentions } = await this.#httpClient.getPersonMentions({
          auth: auth ?? '',
          limit: 50,
          unread_only: true,
          sort: 'New'
        });

        await useDatabaseFunctions(
          'mentions',
          async ({ get, upsert }) => {
            await Promise.all(
              mentions.map(async (mentionView) => {
                const promise = this.#handleEntry({
                  entry: { mentionView },
                  options: mentionOptions,
                  getStorageInfo: get,
                  id: mentionView.person_mention.id,
                  upsert
                });

                if (this.#auth) {
                  await this.#httpClient.markPersonMentionAsRead({
                    auth: this.#auth,
                    person_mention_id: mentionView.person_mention.id,
                    read: true
                  });
                }

                return promise;
              })
            );
          },
          this.#dbFile
        );
      }, mentionOptions.secondsBetweenPolls);
    }

    if (replyOptions && this.#credentials) {
      this.#runChecker(async (auth) => {
        const { replies } = await this.#httpClient.getReplies({
          auth: auth ?? '',
          limit: 50,
          sort: 'New',
          unread_only: true
        });

        await useDatabaseFunctions(
          'replies',
          async ({ get, upsert }) => {
            await Promise.all(
              replies.map(async (replyView) => {
                const promise = this.#handleEntry({
                  entry: { replyView },
                  options: replyOptions,
                  getStorageInfo: get,
                  id: replyView.comment_reply.id,
                  upsert
                });

                if (this.#auth) {
                  await this.#httpClient.markPersonMentionAsRead({
                    auth: this.#auth,
                    person_mention_id: replyView.comment_reply.id,
                    read: true
                  });
                }

                return promise;
              })
            );
          },
          this.#dbFile
        );
      }, replyOptions.secondsBetweenPolls);
    }

    if (commentReportOptions && this.#credentials) {
      this.#runChecker(async (auth) => {
        const { comment_reports } = await this.#httpClient.listCommentReports({
          unresolved_only: true,
          auth: auth ?? '',
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
      this.#runChecker(async (auth) => {
        const { post_reports } = await this.#httpClient.listPostReports({
          unresolved_only: true,
          auth: auth ?? '',
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
      this.#runChecker(async (auth) => {
        const { private_message_reports } =
          await this.#httpClient.listPrivateMessageReports({
            auth: auth ?? '',
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
      this.#runChecker(async (auth) => {
        const { removed_posts } = await this.#getModlogItems(
          'ModRemovePost',
          auth
        );

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
      this.#runChecker(async (auth) => {
        const { locked_posts } = await this.#getModlogItems(
          'ModLockPost',
          auth
        );

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
      this.#runChecker(async (auth) => {
        const { featured_posts } = await this.#getModlogItems(
          'ModFeaturePost',
          auth
        );

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
      this.#runChecker(async (auth) => {
        const { removed_comments } = await this.#getModlogItems(
          'ModRemoveComment',
          auth
        );

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
      this.#runChecker(async (auth) => {
        const { removed_communities } = await this.#getModlogItems(
          'ModRemoveCommunity',
          auth
        );

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
      this.#runChecker(async (auth) => {
        const { banned_from_community } = await this.#getModlogItems(
          'ModBanFromCommunity',
          auth
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
      this.#runChecker(async (auth) => {
        const { added_to_community } = await this.#getModlogItems(
          'ModAddCommunity',
          auth
        );
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
      this.#runChecker(async (auth) => {
        const { transferred_to_community } = await this.#getModlogItems(
          'ModTransferCommunity',
          auth
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
      this.#runChecker(async (auth) => {
        const { added } = await this.#getModlogItems('ModAdd', auth);

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
      this.#runChecker(async (auth) => {
        const { banned } = await this.#getModlogItems('ModBan', auth);

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
    console.log('Starting bot');
    this.#isRunning = true;
    this.#runBot();
  }

  stop() {
    console.log('stopping bot');
    this.#isRunning = false;
  }

  async #login() {
    if (this.#credentials) {
      console.log('logging in');
      const loginRes = await this.#httpClient.login({
        password: this.#credentials.password,
        username_or_email: this.#credentials.username
      });
      this.#auth = loginRes.jwt;
      if (this.#auth) {
        console.log('logged in');

        if (this.#markAsBot) {
          console.log('Marking account as bot account');

          await this.#httpClient
            .saveUserSettings({
              auth: this.#auth,
              bot_account: true
            })
            .catch((err) => console.error(err));
        }
      }
    }
  }

  async #getCommunityIdsForAllowList() {
    if (this.#auth) {
      await Promise.all(
        this.#assignOptionsToMaps(
          this.#federationOptions.allowList,
          'allowMap'
        ).concat(
          this.#assignOptionsToMaps(
            this.#federationOptions.blockList,
            'blockMap'
          )
        )
      );
    }
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
        ...entry
      });

      await upsert(id, get());
    }
  }

  #filterFromResponse<T extends PostView | CommentView>(response: T[]) {
    if ((this.#federationOptions.allowList?.length ?? 0) > 0) {
      return response.filter((d) => {
        const instance = extractInstanceFromActorId(d.community.actor_id);

        return (
          this.#federationOptionMaps.allowMap.get(instance) === true ||
          (
            this.#federationOptionMaps.allowMap.get(instance) as
              | Set<number>
              | undefined
          )?.has(d.community.id)
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

    const { communities, users } = await this.#httpClient.search({
      auth: this.#auth,
      q: localOptions.name,
      type_: type
    });

    if (type === 'Communities') {
      return communities.find(
        (community) =>
          (community.community.name === localOptions.name ||
            community.community.title === localOptions.name) &&
          extractInstanceFromActorId(community.community.actor_id) ===
            instanceWithoutPort
      )?.community.id;
    } else {
      return users.find(
        (user) =>
          (user.person.name === localOptions.name ||
            user.person.display_name === localOptions.name) &&
          extractInstanceFromActorId(user.person.actor_id) ===
            instanceWithoutPort
      )?.person.id;
    }
  }

  #getModlogItems = (type: ModlogActionType, auth?: string) =>
    this.#httpClient.getModlog({
      type_: type,
      limit: 50,
      auth
    });

  async #performLoggedInBotAction<T>({
    logMessage,
    action
  }: {
    logMessage: string;
    action: () => Promise<T>;
  }) {
    if (this.#auth) {
      console.log(logMessage);
      await action();
    }
  }
}

export default LemmyBot;
