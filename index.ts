import { LemmyBot } from './src/bot';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  username: 'ReplyBot',
  password: 'lemmylemmy',
  handlerOptions: {
    post: {
      handle: ({ post, botActions: { replyToPost }, reprocess }) => {
        if (post.creator.name === 'dickhead') {
          replyToPost(
            post,
            'I will keep replying to this even though I should not'
          );
          reprocess(1);
        }
      }
    }
  }
});

bot.start();
