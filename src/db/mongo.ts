import { MongoClient, MongoServerError, type Db, type Document } from "mongodb";
import { describeError, type Logger } from "../logger.ts";

export const COLLECTIONS = {
  customers: "customers",
  processedUpdates: "processed_updates",
} as const;

/** Telegram keeps undelivered updates for 24 hours; keep duplicate markers a little longer. */
export const PROCESSED_UPDATE_TTL_SECONDS = 25 * 60 * 60;

const nullableString = { bsonType: ["string", "null"] };
const nullableDate = { bsonType: ["date", "null"] };

/**
 * Server-side schema for customers. `additionalProperties: false` makes the
 * database itself reject any field outside the documented registration scope
 * (for example phone numbers, birthdays or bios).
 *
 * Telegram IDs are stored as BSON int64 ("long"), which holds every Telegram
 * identifier without precision loss.
 */
export const CUSTOMER_SCHEMA: Document = {
  bsonType: "object",
  additionalProperties: false,
  required: [
    "telegramUserId", "telegramChatId", "username", "firstName", "lastName", "languageCode", "isBot",
    "chatType", "chatTitle", "profilePhotoFileId", "profilePhotoFileUniqueId", "profilePhotoCheckedAt",
    "registrationSource", "lastEvent", "registeredAt", "lastInteractionAt", "createdAt", "updatedAt",
  ],
  properties: {
    _id: { bsonType: "objectId" },
    telegramUserId: { bsonType: "long" },
    telegramChatId: { bsonType: "long" },
    username: nullableString,
    firstName: nullableString,
    lastName: nullableString,
    languageCode: nullableString,
    isBot: { bsonType: "bool" },
    chatType: { bsonType: "string" },
    chatTitle: nullableString,
    profilePhotoFileId: nullableString,
    profilePhotoFileUniqueId: nullableString,
    profilePhotoCheckedAt: nullableDate,
    registrationSource: { bsonType: "string" },
    lastEvent: { bsonType: "string" },
    registeredAt: { bsonType: "date" },
    lastInteractionAt: { bsonType: "date" },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" },
  },
};

export async function connectMongo(uri: string): Promise<MongoClient> {
  // useBigInt64 makes the driver read int64 values as bigint and write bigint as int64.
  const client = new MongoClient(uri, { useBigInt64: true, appName: "beauty-salon-bot" });
  await client.connect();
  return client;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

const NAMESPACE_EXISTS = 48;

async function ensureCollection(db: Db, name: string, options: Document, logger: Logger): Promise<void> {
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (!exists) {
    try {
      await db.createCollection(name, options);
      return;
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS)) throw error;
    }
  }
  if (options.validator === undefined) return;
  try {
    await db.command({ collMod: name, ...options });
  } catch (error) {
    // collMod needs the dbAdmin role; the validator from the first setup still applies.
    logger.warn("Could not refresh collection validator", { collection: name, error: describeError(error) });
  }
}

/** Idempotently creates collections, validators and indexes. Safe to run on every start. */
export async function ensureSchema(db: Db, logger: Logger): Promise<void> {
  await ensureCollection(
    db,
    COLLECTIONS.customers,
    { validator: { $jsonSchema: CUSTOMER_SCHEMA }, validationLevel: "strict", validationAction: "error" },
    logger,
  );
  await ensureCollection(db, COLLECTIONS.processedUpdates, {}, logger);

  const customers = db.collection(COLLECTIONS.customers);
  await customers.createIndex({ telegramUserId: 1 }, { unique: true, name: "customers_telegram_user_id_uq" });
  await customers.createIndex({ lastInteractionAt: 1 }, { name: "customers_last_interaction_at_idx" });
  await db
    .collection(COLLECTIONS.processedUpdates)
    .createIndex(
      { processedAt: 1 },
      { expireAfterSeconds: PROCESSED_UPDATE_TTL_SECONDS, name: "processed_updates_ttl_idx" },
    );
}
