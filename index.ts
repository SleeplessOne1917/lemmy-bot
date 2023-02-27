import { LemmyBot } from './src/bot';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  username: 'ReplyBot',
  password: 'lemmylemmy',
  handlePost: async ({ post, botActions: { banFromSite } }) => {
    if (post.creator.name === 'dickhead' && !post.creator.banned) {
      banFromSite({
        personId: post.creator.id,
        reason: 'Even kekkier',
        removeData: true
      });
    }
  }
});

bot.start();
