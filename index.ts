import { LemmyBot } from './src/bot';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  password: 'lemmylemmy',
  username: 'ReplyBot',
  handlers: {
    comment: ({ comment, botActions: { replyToComment } }) => {
      if (comment.comment.content.includes('420')) {
        replyToComment(comment, 'Blaze it!');
      }
    }
  }
});

bot.start();
