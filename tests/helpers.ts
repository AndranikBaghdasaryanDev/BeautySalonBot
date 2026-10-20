import { randomUUID } from "node:crypto";
import type { Chat, Update, User, UserFromGetMe } from "grammy/types";
import type { Db, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createBot } from "../src/bot/createBot.ts";
import type { SalonConfig } from "../src/config.ts";
import { MongoCustomerRepository, type CustomerRepository } from "../src/db/customerRepository.ts";
import { connectMongo, ensureSchema } from "../src/db/mongo.ts";
import { MongoProcessedUpdateRepository } from "../src/db/processedUpdateRepository.ts";
import { silentLogger, type Logger } from "../src/logger.ts";

/** A throwaway local MongoDB used instead of Atlas in tests. */
export class TestMongo {
  private server: MongoMemoryServer | null = null;
  private clientInstance: MongoClient | null = null;

  async start(): Promise<void> {
    this.server = await MongoMemoryServer.create();
    this.clientInstance = await connectMongo(this.server.getUri());
  }

  get client(): MongoClient {
    if (this.clientInstance === null) throw new Error("TestMongo not started");
    return this.clientInstance;
  }

  get uri(): string {
    if (this.server === null) throw new Error("TestMongo not started");
    return this.server.getUri();
  }

  /** A new, empty database with the production schema and indexes applied. */
  async freshDb(): Promise<Db> {
    const db = this.client.db(`test_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
    await ensureSchema(db, silentLogger);
    return db;
  }

  async stop(): Promise<void> {
    await this.clientInstance?.close();
    await this.server?.stop();
  }
}

export const TEST_TOKEN = `123456789:${"A".repeat(35)}`;

export const testSalon: SalonConfig = {
  name: "Test Salon",
  address: "[Placeholder address]",
  contact: "[Placeholder contact]",
  workingHours: "[Placeholder hours]",
  services: [{ name: "Service A", price: "[price]", duration: "60 min" }],
};

export const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Salon Bot",
  username: "test_salon_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export interface ApiCall {
  readonly method: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FakePhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** In-memory stand-in for the Telegram Bot API HTTP endpoint. */
export class FakeTelegram {
  readonly calls: ApiCall[] = [];
  readonly failures = new Map<string, { code: number; description: string }>();
  photos: FakePhotoSize[][] = [];
  networkDown = false;

  readonly fetch: typeof fetch = (input, init) => {
    if (this.networkDown) return Promise.reject(new Error("network down"));
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = url.slice(url.lastIndexOf("/") + 1);
    const body = init?.body;
    const parsed: unknown = typeof body === "string" && body !== "" ? JSON.parse(body) : {};
    const payload = isRecord(parsed) ? parsed : {};
    this.calls.push({ method, payload });

    const failure = this.failures.get(method);
    const response =
      failure === undefined
        ? { ok: true, result: this.result(method, payload) }
        : { ok: false, error_code: failure.code, description: failure.description };
    return Promise.resolve(
      new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }),
    );
  };

  private result(method: string, payload: Record<string, unknown>): unknown {
    switch (method) {
      case "sendMessage":
      case "editMessageText":
        return {
          message_id: this.calls.length,
          date: 1_700_000_000,
          chat: { id: payload.chat_id ?? 1, type: "private", first_name: "x" },
          text: payload.text,
        };
      case "getUserProfilePhotos":
        return { total_count: this.photos.length, photos: this.photos.slice(0, 1) };
      default:
        return true;
    }
  }

  callsTo(method: string): ApiCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  sentTexts(): string[] {
    return this.callsTo("sendMessage").map((call) => String(call.payload.text));
  }
}

let nextUpdateId = 1000;
export function newUpdateId(): number {
  nextUpdateId += 1;
  return nextUpdateId;
}

export const defaultUser: User = {
  id: 5_000_000_001,
  is_bot: false,
  first_name: "Anna",
  last_name: "Smith",
  username: "anna_s",
  language_code: "en",
};

export function privateChat(user: User): Chat.PrivateChat {
  const chat: Chat.PrivateChat = { id: user.id, type: "private", first_name: user.first_name };
  if (user.username !== undefined) chat.username = user.username;
  return chat;
}

export function messageUpdate(
  text: string,
  options: { from?: User; chat?: Chat.PrivateChat | Chat.GroupChat | Chat.SupergroupChat; updateId?: number } = {},
): Update {
  const from = options.from ?? defaultUser;
  const commandLength = text.startsWith("/") ? text.split(" ")[0]?.length ?? 0 : 0;
  return {
    update_id: options.updateId ?? newUpdateId(),
    message: {
      message_id: 1,
      date: 1_700_000_000,
      from,
      chat: options.chat ?? privateChat(from),
      text,
      ...(commandLength > 0 ? { entities: [{ type: "bot_command", offset: 0, length: commandLength }] } : {}),
    },
  };
}

export function callbackUpdate(
  data: string,
  options: { from?: User; chat?: Chat.PrivateChat | Chat.GroupChat | Chat.SupergroupChat } = {},
): Update {
  const from = options.from ?? defaultUser;
  return {
    update_id: newUpdateId(),
    callback_query: {
      id: `cb-${String(newUpdateId())}`,
      from,
      chat_instance: "instance",
      data,
      message: {
        message_id: 7,
        date: 1_700_000_000,
        chat: options.chat ?? privateChat(from),
        text: "menu",
        from: botInfo,
      },
    },
  };
}

export interface TestContext {
  readonly db: Db;
  readonly customers: CustomerRepository;
  readonly telegram: FakeTelegram;
  readonly send: (update: Update) => Promise<void>;
  readonly clock: { now: Date };
}

export function setup(
  db: Db,
  options: { customers?: (db: Db) => CustomerRepository; logger?: Logger } = {},
): TestContext {
  const customers = options.customers?.(db) ?? new MongoCustomerRepository(db);
  const telegram = new FakeTelegram();
  const clock = { now: new Date("2026-01-01T10:00:00.000Z") };
  const bot = createBot({
    token: TEST_TOKEN,
    salon: testSalon,
    customers,
    processedUpdates: new MongoProcessedUpdateRepository(db),
    logger: options.logger ?? silentLogger,
    profilePhotoRefreshHours: 24,
    now: () => clock.now,
    botInfo,
    client: { fetch: telegram.fetch },
  });
  return { db, customers, telegram, send: (update) => bot.handleUpdate(update), clock };
}

export function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string, fields?: Readonly<Record<string, unknown>>) => {
    lines.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`);
  };
  return { lines, debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
}
