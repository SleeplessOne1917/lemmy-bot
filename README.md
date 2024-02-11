<div align="center">
  <img src="https://img.shields.io/npm/l/lemmy-bot?style=plastic" alt="License" />
  <img src="https://img.shields.io/librariesio/github/SleeplessOne1917/lemmy-bot?style=plastic" alt="Dependencies up to date" />
  <img src="https://img.shields.io/github/stars/SleeplessOne1917/lemmy-bot?style=plastic" alt="Github stars" />
  <img src="https://img.shields.io/npm/v/lemmy-bot?style=plastic" alt="npm version" />
  <img src="https://img.shields.io/github/last-commit/SleeplessOne1917/lemmy-bot/main?style=plastic" alt="Last commit" />
  <img src="https://img.shields.io/github/issues/SleeplessOne1917/lemmy-bot?style=plastic" alt="Issues" />
  <img src="https://img.shields.io/github/issues-pr-raw/SleeplessOne1917/lemmy-bot?style=plastic" alt="Open pull requests" />
  <img src="https://img.shields.io/npm/dm/lemmy-bot" alt="Downloads per month" />
  <img src="https://img.shields.io/badge/-Typescript-white?logo=typescript&style=plastic" alt="Typescript">
</div>
<div align="center">
  <a href="https://github.com/LemmyNet/lemmy" rel="noopener">
  <img src="https://raw.githubusercontent.com/LemmyNet/lemmy-ui/main/src/assets/icons/favicon.svg" alt="Lemmy logo" width="250px" height="250px"/>
  
  <h1 align="center">lemmy-bot</h1>
  <p align="center">Library to make it easier to make bots for <a href="https://join-lemmy.org/">Lemmy</a>, the fediverse forum/link aggregator.</p>
</div>

## Features

- Respond to different events that happen in lemmy, such as posts, comments, and modlog actions
- Perform actions on a schedule
- Supports most actions a regular Lemmy account can make, including moderator and admin actions

## Installation

**Note**: This library only works with Node versions 18 and above.

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

## Lemmy Versions

For lemmy versions 0.17.x, use lemmy-bot 0.3.9 and lower.

For lemmy versions 0.18.x, use lemmy-bot 0.4.x.

For lemmy versions 0.19.x, use lemmy-bot 0.5.0 and up.

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

Log in credentials for the bot. Accepts an object with `username` and `password` properties. If not provided, the bot can still poll the instance for items like posts, comments, and modlog actions, but it will not be able to perform actions that require an account.

#### `instance` **REQUIRED**

The Lemmy instance your bot will connect to. Only pass the domain name of the instance, e.g. if the bot is supposed to be on lemmy.ml, pass `'lemmy.ml'`, **not** `'https://lemmy.ml'`.

#### `connection`

Options for the bot's connection. It is an object with the following properties:

- `minutesBeforeRetryConnection`: If the bot's connection closes, the bot will wait this many minutes before opening another connection and trying again. Default value is 5. If you don't want the bot to attempt to reconnect, pass in `false`.
- `secondsBetweenPolls`: Number of seconds between HTTP requests the bot will make to check for items to handle. Default value is 30.
- `minutesUntilReprocess`: If the bot can to potentially handle the same item more than once (e.g. polling posts by top day every minute and replying to any with more than 25 points), `minutesUntilReprocess` specifies how many minutes must pass until an item is valid for reprocessing. If this value is undefined, items will not be reprocessed at all. Default value is undefined.
  **Note**: It is possible that an item that is valid for reprocessing will not be handled again. Taking the example from before and polling every day instead of every minute, a post from the day before that is valid for reprocessing might not show up in the current day's top posts.

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

**Note**: If you want to limit checking on your local instance to only a few communities, do not pass `local`; instead, pass an object with an `allowList` with your local instance domain and desired communities.

#### `schedule`

Task object or list of task objects. Task objects have the following properties:

- `cronExpression`: String expression that controls when the task runs. See [node-cron](https://www.npmjs.com/package/cron) for valid expression syntax.
- `doTask`: Run the task. Takes [bot actions](#bot-actions) as an argument.
- `timezone`: String stating the timezone the schedule should be in. See [here](https://momentjs.com/timezone/) for supported timezones.
- `runAtStart`: Boolean value for whether or not the task should be run immediately. Defaults to false.

#### `dbFile`

The bot tracks which items it has handled already in a SQLite database. Accepts a string path to the file to use a database: will create the file if it does not already exist.
If this option is not specified, the bot will store the SQLite DB in memory. This can be useful during development, but it is recommended to use a file when running in production.

#### `markAsBot`

If true, the bot will automatically mark its own account as a bot. If false, make sure to remember to mark the bot's account
as a bot in the account's settings.

Default value is `true`.

#### `dryRun`

If `true`, no network requests will be made to your lemmy instance. If `false`, the bot will contact the instance configured in `instance`. Use this in combination with `enableLogs` and without `credentials` when doing development or testing to avoid unwanted actions in production.

Default value is `false`.

#### `enableLogs`

If true, the bot will log every action it does to the console.

Default value is `true`.

---

### Bot Actions

When handling an item or running a scheduled task, the bot will have access to several actions it can perform as an argument.

The actions are as follows, grouped by access level in ascending order:

#### No login required

- `getCommunity(form: GetCommunity)`: Retrieves community. the request form can accept either a community ID or a community name. If you are doing the latter, use `"{community name}@{instance}"` to get results more reliably.
- `getPersonDetails(form: GetPersonDetails)`: Gets details about a person, including posts and comments they made and communities the moderate.
- `getPost(form: GetPost)`: Retrieve a post based on its ID.
- `getComment(form: GetComment)`: Retrieve a comment based on its ID.
- `getParentOfComment(form: Comment)`: Retrieves the parent of a comment. Accepts a comment object, which is returned from handlers that deal with comments (e.g. comment handler, mention handler, reply handler, etc.). Returns an object with the following properties:
  - `type` `"post"` or `"comment"`
  When `type` is `"post"`:
  - `post`: `GetPostResponse`
  When `type` is `"comment"`:
  - `comment`: `CommentResponse`
- `isCommunityMod(form: {community: Community, person: Person})`: Returns whether or not a person is a moderator of a given community.

#### Regular account

- `createComment(form: CreateComment)`: Create a comment. Accepts an object with the following properties:
  - `content` string
  - `post_id` number
  - `parent_id` _optional_ number
  - `language_id` _optional_ number
- `reportComment(form: ReportComment)`: Report a comment. Accepts an object with the following properties:
  - `comment_id` number
  - `reason` string
- `reportPost(form: ReportPost)`: Report a post. Accepts an object with the following properties:
  - `post_id` number
  - `reason` string
- `votePost(form: VotePost)`: Vote on a post. Accepts an object with the following properties:
  - `post_id` number
  - `vote` Vote
- `voteComment(form: VoteComment)`: Vote on a comment. Accepts an object with the following properties:
  - `comment_id` number
  - `vote` Vote
- `createPost(form: CreatePost)`: Create a post. `form` has the following properties:
  - `name` string
  - `url` _optional_ string
  - `body` _optional_ string
  - `nsfw` _optional_ boolean
  - `language_id` _optional_ number
  - `community_id` number
  - `honeypot` _optional_ string
- `sendPrivateMessage(form: SendPrivateMessage)`: Send a private message to a user. Accepts an object with the following properties:
  - `recipient_id` number
  - `content` string
- `reportPrivateMessage(form: ReportPrivateMessage)`: Report a private message. Accepts an object with the following properties:
  - `privateMessage_id` number
  - `reason` string
- `uploadImage(image: Buffer)`: Upload an image to pictrs. Returns a promise with an `UploadImageResponse`.
- `resolveObject(form: ResolveObject)`: Resolves an object on a remote instance. Use this to federate with communities that aren't showing up on your local instance yet. **Note**: If passing in a string, make sure it is in the format "!'community name'@'instance domain'".
- `followCommunity(form: FollowCommunity)`: Subscribe to a community.
- `editPost(form: EditPost)`: Edit a post that was made previously by the bot. The `form` argument has the following properties:
  - `post_id` number
  - `name` _optional_ string
  - `url` _optional_ string
  - `body` _optional_ string
  - `nsfw` _optional_ boolean
  - `language_id` _optional_ number
- `editComment(form: EditComment)`: Edit a comment previously made by the bot. The `form` argument has the following properties:
  - `comment_id` number
  - `content` _optional_ string
  - `language_id` _optional_ number

#### Community moderator

- `banFromCommunity(form: BanFromCommunity)`: Ban or unban a user from a community. Accepts an object with the following properties:
  - `community_id` number
  - `person_id` number
  - `ban` boolean
  - `expires` _optional_ number
  - `reason` _optional_ string
  - `remove_data` _optional_ boolean
- `removePost(form: RemovePost)`: Remove a post. Accepts an object with the following properties:
  - `post_id` number
  - `removed` boolean
  - `reason` _optional_ string
- `distinguishComment(form: DistinguishComment)`: Pin a comment to the top of a comment thread. Accepts an object with the following properties:
  - `comment_id` number
  - `distinguished` boolean
- `removeComment(form: RemoveComment)`: Remove a comment. Accepts an object with the following properties:
  - `comment_id` number
  - `removed` boolean
  - `reason` _optional_ string
- `resolveCommentReport(form: ResolveCommentReport)`: Resolve a comment report. Accepts an object with the following properties:
  - `report_id` number
  - `resolved` boolean
- `resolvePostReport(form: ResolvePostReport)`: Resolve a post report. Accepts an object with the following properties:
  - `report_id` number
  - `resolved` boolean
- `resolveMessageReport(form: ResolvePrivateMessageReport)`: Resolve a private message report. Accepts an object with the following propertied:
  - `report_id` number
  - `resolved` boolean
- `featurePost(form: FeaturePost)`: Feature a post. Accepts an object with the following properties:
  - `post_id` number
  - `feature_type`: PostFeatureType
  - `featured`: boolean
- `lockPost(postId: number, locked: boolean)`: Lock/unlock a post. Accepts an object with the following properties:
  - `pst_id` number
  - `locked` boolean

#### Admin

- `getCommentVotes(form: ListCommentLikes)`: Show who voted on a comment, and what their vote is. Accepts an object with the following properties:
  - `comment_id` number
  - `page` __optional__ number
  - `limit` __optional__ number
- `getPostVotes(form: ListPostLikes)`: Show who voted on a post, and what their vote is. Accepts an object with the following properties:
  - `post_id` number
  - `page` __optional__ number
  - `limit` __optional__ number
- `banFromSite(form: BanFromSite)`: Ban or unban a user from the instance. Accepts an object with the following properties:
  - `person_id` number
  - `ban` number
  - `expires` _optional_ number
  - `reason` _optional_ string
  - `remove_data` _optional_ boolean
- `approveRegistrationApplication(form: ApproveRegistrationApplication)`: Approve the creation of an account. Accepts an object with the following properties:
  - `id` number
  - `approve` boolean
  - `deny_reason` __optional__ string

## HTTP Client
If you need to use the [lemmy client](https://github.com/LemmyNet/lemmy-js-client) directly, the `__httpClient__` property is available so you don't need add it to your project separately. For your convenience, you can also access this in paramaters for polled event handlers and scheduled tasks.

## Examples

### Live Examples

- [Translator bot](https://github.com/SleeplessOne1917/lemmy-translator-bot)
- [OCR scanner bot](https://github.com/SleeplessOne1917/lemmy-ocr-bot)
- [Piped link bot](https://github.com/TeamPiped/lemmy-piped-link-bot)
- [Karma bot](https://github.com/programming-dot-dev/karma-bot)
- [Link bot](https://github.com/PangoraWeb/link-bot)
- [Basedcount automoderator](https://github.com/basedcount/lemmy-automoderator)

### Congratulator Bot

This bot will comment a cringy congratulations whenever a post on certain communities receives a score or 25 or more.
Posts are valid to be handled after 10 minutes, but if a post ist congratulated it will no longer be eligible to be processed
(due to `preventReprocess` being called). Posts that it's polling will be sorted by hot, and the bot will only be able to check posts in the shrek or tv communities on instance.xyz or the fediverse, cringe, and cooking communities on fediplace.ml.

```typescript
import LemmyBot from 'lemmy-bot';

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
      sort: 'Hot',
      handle: ({
        postView: {
          counts: { score },
          post: { id }
        },
        botActions: { createComment },
        preventReprocess
      }) => {
        if (score > 25) {
          createComment({
            post_id: id,
            content:
              'WOW, 25+ score!?!?! Das a lot of score-arinos!!!!! Congratulations fedizen! :)'
          });
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
      botActions: { approveRegistrationApplication }
    }) => {
      if (cringeNameRegex.test(name)) {
        approveRegistrationApplication({
          id,
          deny_reason: 'No cringy usernames allowed',
          approve: false
        });
      }
    }
  }
});

bot.start();
```

## Credits

Logo made by Andy Cuccaro (@andycuccaro) under the CC-BY-SA 4.0 license.
