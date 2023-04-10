<div align="center">
  <a href="https://github.com/LemmyNet/lemmy" rel="noopener">
  <img src="images/lemmy_logo.svg" alt="Lemmy logo" width="250px" height="250px"/>
  
  <h1 align="center">lemmy-bot</h1>
  <p align="center">Library to make it easier to make bots for <a href="https://join-lemmy.org/">Lemmy</a>, the fediverse forum/link aggregator.</p>
</div>

## Features

- Respond to different events that happen in lemmy, such as posts, comments, and modlog actions
- Perform actions on a schedule
- Supports most actions a regular Lemmy account can make, including moderator and admin actions
- Polls over websocket to avoid rate limiting.

## Installation

Run

```
npm install lemmy-bot
```

or

```
yarn add lemmy-bot
```

or

```
pnpm install lemmy-bot
```

## Documentation

### LemmyBot

Create a bot by newing up a `LemmyBot`

```typescript
import LemmyBot from 'lemmy-bot';

const bot = new LemmyBot({
  // Pass configuration options here
});
```

Calling `bot.start()` will start the bot. Calling `bot.stop()` will stop it.

---

### LemmyBotOptions

What your bot does is determined by the options passed to the constructor. They are as follows:

#### `credentials`

Log in credentials for the bot. Accepts an object with `username` and `password` properties. If not provided, the bot can still poll the instance for items like posts, comments, and modlog actions, but it will not be able to perform actions that require and account.

#### `instance` **REQUIRED**

The Lemmy instance your bot will connect to. Only pass the domain name of the instance, e.g. if the bot is supposed to be on lemmy.ml, pass `'lemmy.ml'`, **not** `'https://lemmy.ml'`.

#### `connection`

Options for the bot's connection. It is an object with the following properties:

- `minutesBeforeRetryConnection`: If the bot's connection closes, the bot will wait this many minutes before opening another connection and trying again. Default value is 5.
- `secondsBetweenPolls`: Number of seconds between websocket requests the bot will make to check for items to handle. Default value is 10.
- `minutesUntilReprocess`: If the bot can to potentially handle the same item more than once (e.g. polling posts by top day every minute and replying to any with more than 25 points), `minutesUntilReprocess` specifies how many minutes must pass until an item is valid for reprocessing. If this value is undefined, items will not be reprocessed at all. Default value is undefined.
  **NOTE**: It is possible that an item that is valid for reprocessing will not be handled again. Taking the example from before and polling every day instead of every minute, a post from the day before that is valid for reprocessing might not show up in the current day's top posts.

#### `handlers`

Options that control what the bot does when encountering a certain item. The following is a simple example to show how handlers work:

```typescript
import LemmyBot from 'lemmy-bot';

const bot = new LemmyBot({
  handlers: {
    post: (res) => {
      console.log(res.postView.post.name);
    }
  }
});

bot.start();
```

In the previous example, the bot polls the instance for posts and logs the name of each one.

Each handler can accept an object with the following properties:

- `handle`: Function to run to handle an item. Acccepts the item being handled as an argument.
- `secondsBetweenPolls`: Does the same thing as the one from [connection](#connection). Any value provided will override the value set in [connection](#connection) for handling items of a given type.
- `minutesUntilReprocess`: Does the same thing as the one from [connection](#connection). Any value provided will override the value set in [connection](#connection) for handling items of a given type.

Some handlers accept more options.

If using the default values for `secondsBetweenPolling` and `minutesUntilReprocess`, the handle function can be used instead of the object.

The handle function receives an object that has the following props as an argument:

- `botActions`: Different actions the bot can perform. More on bot actions in the [bot actions](#bot-actions) sections.
- `preventReprocess`: Call if the item being handled should not be handled again, even if `minutesUntilReprocess` is set.
- `reprocess`: Mark the item being handled as able to be reprocessed, even if `minutesUntilReprocess` is not set.
- item (property name varies depending on handler): The item being handled.

The following are the properties that can be set on `handlers`:

- `comment`: Handle function has `commentView` in the argument object. Handler options also accept `sort` property of type `CommentSortType`.
- `post`: Handle function has `postView` in the argument object. Handler options also accept `sort` property of type `SortType`.
- `privateMessage`: Handle function has `messageView` in the argument object.
- `comment`: Handle function has `commentView` in the argument object.
- `registrationApplication`: Handle function has `applicationView` in the argument object.
- `mention`: Handle function has `mentionView` in the argument object.
- `reply`: Handle function has `replyView` in the argument object.
- `commentReport`: Handle function has `reportView` in the argument object.
- `postReport`: Handle function has `reportView` in the argument object.
- `privateMessageReport`: Handle function has `reportView` in the argument object.
- `modRemovePost`: Handle function has `removedPostView` in the argument object.
- `modLockPost`: Handle function has `lockedPostView` in the argument object.
- `modFeaturePost`: Handle function has `featurePostView` in the argument object.
- `modRemoveComment`: Handle function has `removedCommentView` in the argument object.
- `modRemoveCommunity`: Handle function has `removedCommunityView` in the argument object.
- `modBanFromCommunity`: Handle function has `banView` in the argument object.
- `modAddModToCommunity`: Handle function has `modAddedToCommunityView` in the argument object.
- `modTransferCommunity`: Handle function has `modTransferredToCommunityView` in the argument object.
- `modAddAdmin`: Handle function has `addedAdminView` in the argument object.
- `modBanFromSite`: Handle function has `banView` in the argument object.

#### `federation`

Options for handling federated instances. Can be one of:

- `'local'`: Only handle items on the bot's local instance. This is the default setting.
- `'all'`: Handle items on any instance, both local and federated.
- object with the following properties:
  - `allowList`: List of instances the bot is allowed to handle items from.
  - `blockList`: List of instances the bot is not allowed to handle ites from.

A bot cannot set both a block list and an allow list.
Entries `allowList` and `blockList` can either be strings or objects. If the entry is a string, all items on the instance named by the string will be allowed/blocked. If an object, it must have the following shape:

- `instance`: Domain name of the instance to allow/block from.
- `communities`: List of community names on the instance that should be allowed/blocked.

#### `schedule`

Task object or list of task objects. Task objects have the following properties:

- `cronExpression`: String expression that controls when the task runs. See [node-cron](https://www.npmjs.com/package/cron) for valid expression syntax.
- `doTask`: Run the task. Takes [bot actions](#bot-actions) as an argument.
- `timezone`: String stating the timezone the schedule should be in. See [here](https://momentjs.com/timezone/) for supported timezones.
- `runAtStart`: Boolean value for whether or not the task should be run immediately. Defaults to false.

#### `dbFile`

The bot tracks which items it has handled already in a SQLite database. Accepts a string path to the file to use a database: will create the file if it does not already exist.
If this option is not specified, the bot will store the SQLite DB in memory. This can be useful during development, but it is recommended to use a file when running in production.

---

### Bot Actions

When handling an item or running a scheduled task, the bot will have access to several actions it can perform as an argument.

The actions are as follows, grouped by access level in ascending order:

#### No login required

- `getCommunityId(options: string | SearchOptions)`: Retrieves a community ID based on name; returns undefined if not found. If passed a string, the bot will look for the community name on the local instance. Can also be passed a `SearchOptions` object with the following propertied:
  - `instance`: Instance the community is on.
  - `name`: Name of the community.
- `getUserId(options: string | SearchOptions)`: Retrieves a user ID based on name; returns undefined if not found. Like `getCommunityName`, accepts either a string to search for a user by name on the local instance, or a `SearchOptions` object to search on another instance.

#### Regular account

- `replyToComment(commentId: number, postId: number, content: string)`: Create a comment replying to another comment.
- `replyToPost(postId: number, content: string)`: Create a comment replying to a post.
- `reportComment(commentId: number, reason: string)`: Report a comment.
- `reportPost(postId: number, reason: string)`: Report a post.
- `votePost(postId: number, vote: Vote)`: Vote on a post.
- `voteComment(commentId: number, vote: Vote)`: Vote on a comment.
- `createPost(form: CreatePost)`: Create a post. `form` has the following properties:
  - `name` string
  - `url` _optional_ string
  - `body` _optional_ string
  - `nsfw` _optional_ boolean
  - `language_id` _optional_ number
  - `community_id` number
  - `honeypot` _optional_ string
- `sendPrivateMessage(recipientId: number, content: string)`: Send a private message to a user.
- `reportPrivateMessage(messageId: number, reason: string)`: Report a private message.
- `uploadImage(image: Buffer)`: Upload an image to pictrs. Returns a promise with an `UploadImageReponse`.

#### Community moderator

- `banFromCommunity(options)`: Ban a user from a community. The options argument has the following shape:
  - `communityId` number
  - `personId` number
  - `daysUntilExpires` _optional_ number
  - `reason` _optional_ string
  - `removeData` _optional_ boolean
- `removePost(postId: number, reason?: string)`: Remove a post.
- `removeComment(commentId: number, reason?: string)`: Remove a comment.
- `resolveCommentReport(commentReportId: number)`: Resolve a comment report.
- `resolvePostReport(postReportId: number)`: Resolve a post report.
- `resolveMessageReport(privateMessageReportId: number)`: Resolve a private message report.
- `featurePost(options)`: Feature a post. Options has the following shape:
  - `postId` number
  - `featureType`: PostFeatureType
  - `featured`: boolean
- `lockPost(postId: number, locked: boolean)`: Lock/unlock a post.

#### Admin

- `banFromSite(options)`: Ban a user from the instance. Options has the following shape:
  - `personId` number
  - `daysUntilExpires` _optional_ number
  - `reason` _optional_ string
  - `removeData` _optional_ boolean
- `approveRegistrationApplication(applicationId: number)`: Approve the creation of an account.
- `rejectRegistrationApplication(applicationId: number, denyReason?: string)`: Deny a request to create an account on the instance.

## Examples

### Like Me Bot

This example bot will like users' posts and comments on request. Users can subscribe and unsubscribe to the liking by messaging the bot.

```typescript
import LemmyBot, { Vote } from 'lemmy-bot';

const usersToLike: number[] = [];

const bot = new LemmyBot({
  instance: 'instance.xyz',
  credentials: {
    username: 'LikeMeBot',
    password: 'password'
  },
  federation: 'all',
  dbFile: 'db.sqlite3',
  handlers: {
    post: {
      handle: ({
        postView: {
          post: { creator_id, id }
        },
        botActions: { votePost }
      }) => {
        if (usersToLike.includes(creator_id)) {
          votePost(id, Vote.Upvote);
        }
      }
    },
    comment: ({
      commentView: {
        comment: { creator_id, id }
      },
      botActions: { voteComment }
    }) => {
      if (usersToLike.includes(creator_id)) {
        voteComment(creator_id, Vote.Upvote);
      }
    },
    privateMessage: ({
      messageView: {
        private_message: { content, creator_id }
      },
      botActions: { sendPrivateMessage }
    }) => {
      const lcContent = content.toLowerCase();
      if (lcContent.includes('like me')) {
        if (usersToLike.includes(creator_id)) {
          sendPrivateMessage(
            creator_id,
            'I am already liking your posts. Message "Stop" to unsubscribe.'
          );
        } else {
          usersToLike.push(creator_id);
          sendPrivateMessage(
            creator_id,
            'You are now subscribed! I will like anything you post'
          );
        }
      } else if (lcContent.includes('stop')) {
        if (!usersToLike.includes(creator_id)) {
          sendPrivateMessage(
            creator_id,
            'You are already unsubscribed from my likes'
          );
        } else {
          for (let i = 0; i < usersToLike.length; ++i) {
            if (usersToLike[i] === creator_id) {
              usersToLike.splice(i, 1);
              break;
            }
          }
        }
      } else {
        sendPrivateMessage(
          creator_id,
          'Command not recognized. Send a message to me that says "Like me" if you want me to like your posts. If you don\'t want me to like your posts anymore, message me "Stop"'
        );
      }
    }
  }
});

bot.start();
```

### Congratulator Bot

This bot will comment a cringy congratulations whenever a post on certain communities receives a score or 25 or more.
Posts are valid to be handled after 10 minutes, but if a post ist congratulated it will no longer be eligible to be processed
(due to `preventReprocess` being called). Posts that it's polling will be sorted by hot, and the bot will only be able to check posts in the shrek or tv communities on instance.xyz or the fediverse, cringe, and cooking communities on fediplace.ml.

```typescript
import LemmyBot, { SortType } from 'lemmy-bot';

const bot = new LemmyBot({
  instance: 'instance.xyz',
  credentials: {
    username: 'CongratulatorBot',
    password: 'password'
  },
  connection: {
    minutesUntilReprocess: 10,
    secondsBetweenPolls: 120
  },
  dbFile: 'db.sqlite3',
  federation: {
    allowList: [
      {
        instance: 'instance.xyz',
        communities: ['shrek', 'tv']
      },
      {
        instance: 'fediplace.ml',
        communities: ['fediverse', 'cringe', 'cooking']
      }
    ]
  },
  handlers: {
    post: {
      sort: SortType.Hot,
      handle: ({
        postView: {
          counts: { score },
          post: { id }
        },
        botActions: { replyToPost },
        preventReprocess
      }) => {
        if (score > 25) {
          replyToPost(
            id,
            'WOW, 25+ score!?!?! Das a lot of score-arinos!!!!! Congratulations fedizen! :)'
          );
          preventReprocess();
        }
      }
    }
  }
});

bot.start();
```

### Cringe username rejector

This bot will reject registration applications of anyone with a cringy username. The bot must have admin privileges to work.

```typescript
import LemmyBot from 'lemmy-bot';

const cringeNameRegex = /(^(x|X)+.+(x|X)+$)|69|420/;

const bot = new LemmyBot({
  instance: 'instance.ml',
  credentials: {
    username: 'CringeRejector',
    password: 'password'
  },
  handlers: {
    registrationApplication: ({
      applicationView: {
        creator: { name },
        registration_application: { id }
      },
      botActions: { rejectRegistrationApplication }
    }) => {
      if (cringeNameRegex.test(name)) {
        rejectRegistrationApplication(id, 'No cringy usernames allowed');
      }
    }
  }
});

bot.start();
```

## Credits

Logo made by Andy Cuccaro (@andycuccaro) under the CC-BY-SA 4.0 license.
