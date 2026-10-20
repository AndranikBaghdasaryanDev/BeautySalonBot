# Beauty Salon Telegram Bot

A Telegram bot for a beauty salon. When a user presses **/start**, the bot registers them automatically from the information the Telegram Bot API includes in the update, stores it in **MongoDB Atlas**, and shows a menu with services, contacts, the user's profile and privacy information. Users can delete their data at any time.

Anyone on Telegram can use the bot. No phone number, birthday or bio is ever requested or stored.

## Stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js ≥ 22.13 (developed on 24), TypeScript (strict), ES modules |
| Telegram | [grammY](https://grammy.dev) — long polling or webhook |
| Database | MongoDB Atlas via the official `mongodb` driver |
| Tests | `node:test` + `mongodb-memory-server` (no Atlas or Telegram account needed) |
| Lint | ESLint + typescript-eslint (`strictTypeChecked`) |

## Commands

| Command | What it does |
| --- | --- |
| `/start` | Registers or refreshes the customer, then shows the welcome message and main menu. Deep links (`t.me/<bot>?start=instagram`) are recorded as the registration source. |
| `/services` | Services from `BEAUTY_SALON_SERVICES` |
| `/contact` | Address, contact and working hours |
| `/profile` | Everything stored about the user (private chats only) |
| `/privacy` | What is collected, why, and how to delete it |
| `/delete_my_data` | Deletes the customer record after confirmation (private chats only) |
| `/help` | Command list |

The main menu uses inline buttons for the same actions.

## What is stored

Collection `customers`, one document per Telegram user:

| Field | Source |
| --- | --- |
| `telegramUserId` (int64, unique index) | `from.id`, the stable identity key |
| `telegramChatId` (int64) | `chat.id` of the most recent interaction |
| `username`, `firstName`, `lastName`, `languageCode` | `from.*`, nullable |
| `isBot` | `from.is_bot` (bot accounts are not registered) |
| `chatType`, `chatTitle` | `chat.type`, `chat.title` (title only for groups) |
| `profilePhotoFileId`, `profilePhotoFileUniqueId`, `profilePhotoCheckedAt` | `getUserProfilePhotos` (identifiers only, the image is never downloaded) |
| `registrationSource` | `start` or `start:<deep-link payload>`, set once |
| `lastEvent` | e.g. `start_command`, `command:services`, `callback_query` |
| `registeredAt` | set once on first registration, never changed |
| `lastInteractionAt`, `createdAt`, `updatedAt` | timestamps |

The collection has a `$jsonSchema` validator with `additionalProperties: false`, so MongoDB itself rejects any other field (for example a phone number).

Collection `processed_updates` holds only Telegram `update_id`s, to ignore duplicate webhook deliveries. A TTL index removes entries after 25 hours.

### Registration rules

- Registration is an atomic upsert keyed by `telegramUserId`, with a unique index, so repeated or concurrent `/start` updates never create duplicates.
- A field missing from a later update (for example a removed username) **does not** erase the stored value.
- Messages and button presses from registered users refresh their metadata and `lastInteractionAt`, but never create a record. Only `/start` registers.
- The profile photo is looked up on `/start` at most once every `PROFILE_PHOTO_REFRESH_HOURS` (default 24).

## Setup

### 1. MongoDB Atlas

1. Create a cluster (the free M0 tier is fine).
2. **Database Access**: create a database user with `readWrite` on the database (for example `beauty_salon`). Adding `dbAdmin` on that database also lets the bot update the schema validator on later releases.
3. **Network Access**: allow the IP address of the machine or server that runs the bot.
4. **Connect → Drivers**: copy the `mongodb+srv://...` connection string.

### 2. Configure

```bash
cp .env.example .env    # on Windows: copy .env.example .env
```

Fill in `.env`:

| Variable | Required | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | Token from @BotFather |
| `MONGODB_URI` | yes | Atlas connection string |
| `MONGODB_DB_NAME` | no | Default `beauty_salon` |
| `BEAUTY_SALON_NAME`, `BEAUTY_SALON_ADDRESS`, `BEAUTY_SALON_CONTACT` | yes | Shown to customers |
| `BEAUTY_SALON_WORKING_HOURS` | no | Shown in `/contact` |
| `BEAUTY_SALON_SERVICES` | no | `name\|price\|duration;name\|price\|duration` |
| `BOT_MODE` | no | `polling` (default) or `webhook` |
| `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET` | webhook only | https URL; secret of 16–256 chars `A-Z a-z 0-9 _ -` |
| `PORT`, `HOST` | no | Webhook listener, default `8080` / `0.0.0.0` |
| `PROFILE_PHOTO_REFRESH_HOURS` | no | Default `24` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn`, `error` |

### 3. Install, build, run

```bash
npm install
npm run build
npm run db:setup   # optional: creates collections, validator and indexes (the bot also does this on start)
npm start
```

For development without a build step (Node 24 runs TypeScript directly): `npm run dev`.

Polling mode needs no public URL and suits a single always-on process. For webhook mode, run the bot behind HTTPS (a reverse proxy or a platform such as Render or Railway), set `BOT_MODE=webhook` plus the webhook variables, and the bot registers the webhook with Telegram's secret-token header on start. Requests without the correct `X-Telegram-Bot-Api-Secret-Token` are rejected with 401. `GET /healthz` is available for health checks.

### Deploying to Vercel (24/7, webhook mode)

The repository is a ready Vercel project. `npm run build` compiles to `dist/`, and `api/telegram.js` exposes the bot as a serverless function at `/api/telegram`. The MongoDB connection is reused between invocations.

1. Import the GitHub repository in Vercel (or run `vercel link`). Pushes to `main` then deploy automatically.
2. In **Project → Settings → Environment Variables** (Production), add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `MONGODB_URI`, `MONGODB_DB_NAME` and the `BEAUTY_SALON_*` variables.
3. In MongoDB Atlas **Network Access**, allow `0.0.0.0/0`. Vercel functions have no fixed IP addresses, so the database user's password protects the database.
4. After the first deployment, point Telegram at it once:
   ```bash
   TELEGRAM_WEBHOOK_URL=https://<your-project>.vercel.app/api/telegram npm run webhook:set
   ```
   On Windows PowerShell: `$env:TELEGRAM_WEBHOOK_URL="https://<your-project>.vercel.app/api/telegram"; npm run webhook:set`

To change salon details, edit the environment variables in Vercel and redeploy.

> Do not run `npm start` (polling mode) on your computer while the webhook is active. Long polling removes the webhook, and the deployed bot stops receiving messages until you run `npm run webhook:set` again.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test          # first run downloads a MongoDB binary for the in-memory test server
npm run build
npm run check     # all of the above
```

## Security and privacy

- Secrets come only from environment variables. `.env` is git-ignored.
- Logs are structured JSON and contain no tokens, names, usernames or Telegram IDs (only the internal document id).
- All user-supplied values are passed to MongoDB as `$literal` values, so a name like `$gt` can never act as an operator.
- `/profile` and data deletion only work in private chats, so data is never shown in a group.
- No HTTP endpoint exposes customer data.
- Deleting data removes the customer document. `processed_updates` contains no personal data.
- Telegram API errors (for example a user who blocked the bot) are logged and not retried. Other failures are re-thrown so Telegram can redeliver the update.

## Telegram Bot API limitations

- Bots cannot read phone numbers, birthdays or bios from a normal update. This bot does not ask for them.
- `username`, `last_name` and `language_code` are optional and often missing. `language_code` reflects the Telegram app language, not a verified locale.
- Profile photos are only returned if the user's privacy settings allow it. A photo `file_id` belongs to this bot and cannot be used by other bots.
- A bot can only message users who have started it. A user who blocks the bot causes 403 errors, which are logged.
- In webhook mode Telegram may deliver the same update more than once. Duplicates are ignored by `update_id`.
- Bots cannot see a user's past activity. Data collection starts at the first `/start`.

## Project layout

```
src/
  index.ts                  entry point (polling or webhook)
  setupDatabase.ts          `npm run db:setup`
  config.ts                 environment parsing and validation
  logger.ts                 PII-free JSON logger
  server.ts                 webhook HTTP server
  bot/createBot.ts          handlers and middleware
  bot/messages.ts           all customer-facing text
  bot/keyboards.ts          inline keyboards
  services/registration.ts  update → profile snapshot, registration
  services/profilePhoto.ts  profile photo identifiers
  db/mongo.ts               connection, schema validator, indexes
  db/customerRepository.ts  customer persistence
  db/processedUpdateRepository.ts  duplicate-update guard
tests/                      node:test suites
```
