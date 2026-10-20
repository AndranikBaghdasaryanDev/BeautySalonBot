import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { COLLECTIONS } from "../src/db/mongo.ts";
import { silentLogger } from "../src/logger.ts";
import { createWebhookHandler, type RequestHandler } from "../src/vercel.ts";
import { FakeTelegram, TEST_TOKEN, TestMongo, botInfo, messageUpdate } from "./helpers.ts";

const SECRET = "vercel-webhook-secret-0123456789";
const mongo = new TestMongo();
const telegram = new FakeTelegram();
let handle: RequestHandler;
let dbName: string;

before(async () => {
  await mongo.start();
  dbName = (await mongo.freshDb()).databaseName;
  handle = await createWebhookHandler({
    env: {
      TELEGRAM_BOT_TOKEN: TEST_TOKEN,
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      MONGODB_URI: mongo.uri,
      MONGODB_DB_NAME: dbName,
      BEAUTY_SALON_NAME: "Salon",
      BEAUTY_SALON_ADDRESS: "[address]",
      BEAUTY_SALON_CONTACT: "[contact]",
    },
    logger: silentLogger,
    botInfo,
    client: { fetch: telegram.fetch },
    connect: () => Promise.resolve(mongo.client),
  });
});

after(() => mongo.stop());

function request(secret: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("https://bot.example/api/telegram", {
    method: "POST",
    headers,
    body: JSON.stringify(messageUpdate("/start")),
  });
}

describe("Vercel webhook handler", () => {
  it("rejects requests without the correct secret token", async () => {
    assert.equal((await handle(request("wrong"))).status, 401);
    assert.equal((await handle(request(null))).status, 401);
    assert.equal(await mongo.client.db(dbName).collection(COLLECTIONS.customers).countDocuments(), 0);
  });

  it("registers the user and replies for a valid update", async () => {
    const response = await handle(request(SECRET));
    assert.equal(response.status, 200);
    assert.equal(await mongo.client.db(dbName).collection(COLLECTIONS.customers).countDocuments(), 1);
    assert.equal(telegram.callsTo("sendMessage").length, 1);
  });
});
