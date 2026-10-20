import { registerCommands } from "./bot/commands.ts";
import { createBot } from "./bot/createBot.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { MongoCustomerRepository } from "./db/customerRepository.ts";
import { connectMongo, ensureSchema } from "./db/mongo.ts";
import { MongoProcessedUpdateRepository } from "./db/processedUpdateRepository.ts";
import { createLogger, describeError, parseLogLevel } from "./logger.ts";
import { createWebhookServer } from "./server.ts";

const ALLOWED_UPDATES = ["message", "callback_query"] as const;

async function main(): Promise<void> {
  const logger = createLogger(parseLogLevel(process.env.LOG_LEVEL));

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error("Invalid configuration", { error: error.message });
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const mongo = await connectMongo(config.mongo.uri);
  const db = mongo.db(config.mongo.dbName);
  await ensureSchema(db, logger);
  logger.info("Database ready");

  const bot = createBot({
    token: config.botToken,
    salon: config.salon,
    customers: new MongoCustomerRepository(db),
    processedUpdates: new MongoProcessedUpdateRepository(db),
    logger,
    profilePhotoRefreshHours: config.profilePhotoRefreshHours,
  });

  await bot.init();
  await registerCommands(bot.api);
  logger.info("Bot initialised", { bot: bot.botInfo.username, mode: config.mode });

  let stop: () => Promise<void>;

  if (config.webhook === null) {
    stop = () => bot.stop();
    void bot
      .start({
        allowed_updates: [...ALLOWED_UPDATES],
        onStart: () => { logger.info("Long polling started"); },
      })
      .catch((error: unknown) => {
        logger.error("Long polling stopped with an error", { error: describeError(error) });
        process.exitCode = 1;
      });
  } else {
    const { webhook } = config;
    const server = createWebhookServer(bot, webhook.path, webhook.secret, logger);
    await new Promise<void>((resolve) => server.listen(webhook.port, webhook.host, resolve));
    await bot.api.setWebhook(webhook.url, {
      secret_token: webhook.secret,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    logger.info("Webhook server listening", { port: webhook.port });
    stop = () => new Promise<void>((resolve) => server.close(() => { resolve(); }));
  }

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    stop()
      .catch((error: unknown) => { logger.error("Shutdown error", { error: describeError(error) }); })
      .finally(() => {
        void mongo.close();
      });
  };
  process.once("SIGINT", () => { shutdown("SIGINT"); });
  process.once("SIGTERM", () => { shutdown("SIGTERM"); });
}

main().catch((error: unknown) => {
  createLogger().error("Fatal startup error", { error: describeError(error) });
  process.exitCode = 1;
});
