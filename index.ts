import { LemmyBot } from './src/bot';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  username: 'ReplyBot',
  password: 'lemmylemmy',
  handlePost: async ({ alreadyReported, botActions: { reportPost }, post }) => {
    if (!alreadyReported && post.post.name.toLowerCase().includes('joos')) {
      reportPost(post, 'Me am joo and iz offended');
    }
  },
});

bot.start();
