import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Db } from "mongodb";
import { MongoCustomerRepository, type TelegramProfileSnapshot } from "../src/db/customerRepository.ts";
import { COLLECTIONS, CUSTOMER_SCHEMA, ensureSchema } from "../src/db/mongo.ts";
import { MongoProcessedUpdateRepository } from "../src/db/processedUpdateRepository.ts";
import { silentLogger } from "../src/logger.ts";
import { TestMongo } from "./helpers.ts";

const base: TelegramProfileSnapshot = {
  telegramUserId: 7_123_456_789n,
  telegramChatId: 7_123_456_789n,
  username: "anna_s",
  firstName: "Anna",
  lastName: "Smith",
  languageCode: "en",
  isBot: false,
  chatType: "private",
  chatTitle: null,
};

const t0 = new Date("2026-01-01T10:00:00.000Z");
const t1 = new Date("2026-01-02T12:30:00.000Z");

const mongo = new TestMongo();
before(() => mongo.start());
after(() => mongo.stop());

async function freshRepository(): Promise<{ db: Db; repo: MongoCustomerRepository }> {
  const db = await mongo.freshDb();
  return { db, repo: new MongoCustomerRepository(db) };
}

describe("schema setup", () => {
  it("is idempotent", async () => {
    const db = await mongo.freshDb();
    await ensureSchema(db, silentLogger);
    const indexes = await db.collection(COLLECTIONS.customers).indexes();
    const unique = indexes.find((index) => index.name === "customers_telegram_user_id_uq");
    assert.equal(unique?.unique, true);
  });

  it("does not define phone, birthday or bio fields", () => {
    const schemaProperties: unknown = CUSTOMER_SCHEMA.properties;
    assert.ok(typeof schemaProperties === "object" && schemaProperties !== null);
    for (const field of Object.keys(schemaProperties)) {
      assert.doesNotMatch(field, /phone|birth|bio|description/i);
    }
  });

  it("rejects documents with fields outside the registration scope", async () => {
    const { db, repo } = await freshRepository();
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    await assert.rejects(
      db.collection(COLLECTIONS.customers).updateOne({ telegramUserId: base.telegramUserId }, {
        $set: { phoneNumber: "+10000000000" },
      }),
      /Document failed validation/,
    );
  });

  it("enforces a unique Telegram user ID at the database level", async () => {
    const { db, repo } = await freshRepository();
    const { customer } = await repo.registerOrUpdate(base, "start", "start_command", t0);
    const { _id: _omit, ...copy } = (await db.collection(COLLECTIONS.customers).findOne({}))
      ?? assert.fail("missing customer");
    assert.ok(customer.id.length > 0);
    await assert.rejects(db.collection(COLLECTIONS.customers).insertOne(copy), /E11000/);
  });

  it("stores Telegram IDs as 64-bit integers", async () => {
    const { db, repo } = await freshRepository();
    const big = { ...base, telegramUserId: 9_007_199_254_740_991n, telegramChatId: -1_009_007_199_254n };
    await repo.registerOrUpdate(big, "start", "start_command", t0);
    const typed = await db
      .collection(COLLECTIONS.customers)
      .countDocuments({ telegramUserId: { $type: "long" }, telegramChatId: { $type: "long" } });
    assert.equal(typed, 1);
    const found = await repo.findByTelegramUserId(9_007_199_254_740_991n);
    assert.equal(found?.telegramUserId, 9_007_199_254_740_991n);
    assert.equal(found.telegramChatId, -1_009_007_199_254n);
  });
});

describe("MongoCustomerRepository", () => {
  it("creates a new customer with all fields and timestamps", async () => {
    const { repo } = await freshRepository();
    const { customer, created } = await repo.registerOrUpdate(base, "start:promo", "start_command", t0);
    assert.equal(created, true);
    assert.equal(customer.telegramUserId, 7_123_456_789n);
    assert.equal(customer.username, "anna_s");
    assert.equal(customer.registrationSource, "start:promo");
    assert.equal(customer.lastEvent, "start_command");
    assert.deepEqual(customer.registeredAt, t0);
    assert.deepEqual(customer.lastInteractionAt, t0);
    assert.deepEqual(customer.createdAt, t0);
    assert.equal(customer.profilePhotoFileId, null);
  });

  it("updates an existing customer without duplicating or changing registration data", async () => {
    const { repo } = await freshRepository();
    await repo.registerOrUpdate(base, "start:promo", "start_command", t0);
    const { customer, created } = await repo.registerOrUpdate(
      { ...base, username: "anna_new", firstName: "Anne", languageCode: "de" },
      "start:other",
      "start_command",
      t1,
    );
    assert.equal(created, false);
    assert.equal(await repo.count(), 1);
    assert.equal(customer.username, "anna_new");
    assert.equal(customer.firstName, "Anne");
    assert.equal(customer.languageCode, "de");
    assert.equal(customer.registrationSource, "start:promo");
    assert.deepEqual(customer.registeredAt, t0);
    assert.deepEqual(customer.createdAt, t0);
    assert.deepEqual(customer.lastInteractionAt, t1);
    assert.deepEqual(customer.updatedAt, t1);
  });

  it("does not overwrite stored values with null when fields are missing", async () => {
    const { repo } = await freshRepository();
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    const { customer } = await repo.registerOrUpdate(
      { ...base, username: null, firstName: null, lastName: null, languageCode: null },
      "start",
      "start_command",
      t1,
    );
    assert.equal(customer.username, "anna_s");
    assert.equal(customer.firstName, "Anna");
    assert.equal(customer.lastName, "Smith");
    assert.equal(customer.languageCode, "en");
  });

  it("stores values that look like operators as plain text", async () => {
    const { repo } = await freshRepository();
    const { customer } = await repo.registerOrUpdate(
      { ...base, firstName: "$username", lastName: "{$gt: 1}" },
      "start",
      "start_command",
      t0,
    );
    assert.equal(customer.firstName, "$username");
    assert.equal(customer.lastName, "{$gt: 1}");
  });

  it("keeps the chat title for the same chat but replaces it when the chat changes", async () => {
    const { repo } = await freshRepository();
    const group = { ...base, telegramChatId: -100123n, chatType: "supergroup", chatTitle: "Fans" };
    await repo.registerOrUpdate(group, "start", "start_command", t0);
    const same = await repo.registerOrUpdate({ ...group, chatTitle: null }, "start", "x", t1);
    assert.equal(same.customer.chatTitle, "Fans");
    const moved = (await repo.registerOrUpdate(base, "start", "x", t1)).customer;
    assert.equal(moved.chatTitle, null);
    assert.equal(moved.telegramChatId, base.telegramChatId);
  });

  it("touchIfRegistered never creates customers", async () => {
    const { repo } = await freshRepository();
    assert.equal(await repo.touchIfRegistered(base, "message", t0), null);
    assert.equal(await repo.count(), 0);
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    assert.equal((await repo.touchIfRegistered(base, "command:help", t1))?.lastEvent, "command:help");
    const customer = await repo.findByTelegramUserId(base.telegramUserId);
    assert.equal(customer?.lastEvent, "command:help");
    assert.deepEqual(customer.registeredAt, t0);
  });

  it("handles concurrent registrations of the same user without duplicates", async () => {
    const { repo } = await freshRepository();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => repo.registerOrUpdate(base, "start", "start_command", t0)),
    );
    assert.equal(await repo.count(), 1);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(new Set(results.map((r) => r.customer.id)).size, 1);
  });

  it("stores and replaces profile photo identifiers", async () => {
    const { repo } = await freshRepository();
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    await repo.updateProfilePhoto(base.telegramUserId, { fileId: "f1", fileUniqueId: "u1" }, t1);
    let customer = await repo.findByTelegramUserId(base.telegramUserId);
    assert.equal(customer?.profilePhotoFileId, "f1");
    assert.deepEqual(customer.profilePhotoCheckedAt, t1);
    await repo.updateProfilePhoto(base.telegramUserId, null, t1);
    customer = await repo.findByTelegramUserId(base.telegramUserId);
    assert.equal(customer?.profilePhotoFileId, null);
  });

  it("stores the preferred language and keeps it across registrations", async () => {
    const { db, repo } = await freshRepository();
    assert.equal(await repo.setPreferredLanguage(base.telegramUserId, "hy", t0), false);
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    assert.equal(await repo.setPreferredLanguage(base.telegramUserId, "hy", t1), true);
    const { customer } = await repo.registerOrUpdate(base, "start", "start_command", t1);
    assert.equal(customer.preferredLanguage, "hy");
    await assert.rejects(
      db.collection(COLLECTIONS.customers).updateOne({ telegramUserId: base.telegramUserId }, {
        $set: { preferredLanguage: "xx" },
      }),
      /Document failed validation/,
    );
  });

  it("deletes a customer completely", async () => {
    const { db, repo } = await freshRepository();
    await repo.registerOrUpdate(base, "start", "start_command", t0);
    assert.equal(await repo.deleteByTelegramUserId(base.telegramUserId), true);
    assert.equal(await repo.findByTelegramUserId(base.telegramUserId), null);
    assert.equal(await db.collection(COLLECTIONS.customers).countDocuments(), 0);
    assert.equal(await repo.deleteByTelegramUserId(base.telegramUserId), false);
  });
});

describe("MongoProcessedUpdateRepository", () => {
  it("claims each update once and can release a claim", async () => {
    const db = await mongo.freshDb();
    const updates = new MongoProcessedUpdateRepository(db);
    assert.equal(await updates.claim(1, t0), true);
    assert.equal(await updates.claim(1, t0), false);
    await updates.release(1);
    assert.equal(await updates.claim(1, t0), true);
  });

  it("expires markers through a TTL index", async () => {
    const db = await mongo.freshDb();
    const indexes = await db.collection(COLLECTIONS.processedUpdates).indexes();
    assert.equal(indexes.find((i) => i.name === "processed_updates_ttl_idx")?.expireAfterSeconds, 90_000);
  });
});
