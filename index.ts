import { LemmyBot } from './src/bot';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  username: 'ReplyBot',
  password: 'lemmylemmy',
  handlePost({ alreadyReplied, botActions: { replyToPost }, post }) {
    if (!alreadyReplied && post.post.body?.includes('butt')) {
      replyToPost(post, 'Nice butt');
    }
  },
});

bot.start();
