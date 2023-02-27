import { LemmyBot } from './src/bot';
import { Vote } from './src/helpers';

export * from './src/bot';

const bot = new LemmyBot({
  instanceDomain: 'localhost:8536',
  password: 'lemmylemmy',
  username: 'ReplyBot',
  handleComment: async ({
    comment,
    storedData: { myVote },
    botActions: { voteComment }
  }) => {
    if (myVote !== Vote.Downvote && comment.creator.name === 'dickhead') {
      voteComment(comment, Vote.Downvote);
    }
  }
});

bot.start();
