import { webhookCallback, type ApiClientOptions } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { MongoClient } from "mongodb";
import { createBot } from "./bot/createBot.ts";
import { ConfigError, loadConfig, loadWebhookSecret } from "./config.ts";
import { MongoCustomerRepository } from "./db/customerRepository.ts";
import { connectMongo } from "./db/mongo.ts";
import { MongoProcessedUpdateRepository } from "./db/processedUpdateRepository.ts";
import { createLogger, describeError, parseLogLevel, type Logger } from "./logger.ts";

export type RequestHandler = (request: Request) => Promise<Response>;

type Env = Readonly<Record<string, string | undefined>>;

export interface WebhookHandlerOptions {
  readonly env: Env;
  readonly logger: Logger;
  /** Overrides used by tests to avoid real network calls. */
  readonly botInfo?: UserFromGetMe;
  readonly client?: ApiClientOptions;
  readonly connect?: (uri: string) => Promise<MongoClient>;
}

/**
 * Builds a Web-standard (Request -> Response) Telegram webhook handler.
 * Requests without the correct X-Telegram-Bot-Api-Secret-Token get 401.
 */
export async function createWebhookHandler(options: WebhookHandlerOptions): Promise<RequestHandler> {
  const { env, logger } = options;
  const config = loadConfig(env);
  const secret = loadWebhookSecret(env);

  const mongo = await (options.connect ?? connectMongo)(config.mongo.uri);
  const db = mongo.db(config.mongo.dbName);

  const bot = createBot({
    token: config.botToken,
    salon: config.salon,
    customers: new MongoCustomerRepository(db),
    processedUpdates: new MongoProcessedUpdateRepository(db),
    logger,
    profilePhotoRefreshHours: config.profilePhotoRefreshHours,
    ...(options.botInfo === undefined ? {} : { botInfo: options.botInfo }),
    ...(options.client === undefined ? {} : { client: options.client }),
  });
  await bot.init();

  return webhookCallback(bot, "std/http", { secretToken: secret, onTimeout: "return", timeoutMilliseconds: 9_000 });
}

// Serverless instances are reused between invocations, so the MongoDB
// connection and bot are created once per instance, not once per request.
let cached: Promise<RequestHandler> | null = null;

export async function handleTelegramRequest(request: Request): Promise<Response> {
  const logger = createLogger(parseLogLevel(process.env.LOG_LEVEL));
  if (cached === null) {
    cached = createWebhookHandler({ env: process.env, logger });
    // A failed start-up must not be cached forever.
    cached.catch(() => { cached = null; });
  }

  let handle: RequestHandler;
  try {
    handle = await cached;
  } catch (error) {
    logger.error("Webhook handler start-up failed", {
      error: error instanceof ConfigError ? error.message : describeError(error),
    });
    return new Response("Service unavailable", { status: 503 });
  }
  return handle(request);
}
