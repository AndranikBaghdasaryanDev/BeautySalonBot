import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createBot } from "../src/bot/createBot.ts";
import { MongoCustomerRepository } from "../src/db/customerRepository.ts";
import { MongoProcessedUpdateRepository } from "../src/db/processedUpdateRepository.ts";
import { silentLogger } from "../src/logger.ts";
import { createWebhookServer } from "../src/server.ts";
import { FakeTelegram, TEST_TOKEN, TestMongo, botInfo, messageUpdate, testSalon } from "./helpers.ts";

const SECRET = "correct-secret-token-123";
const PATH = "/telegram/webhook";

const mongo = new TestMongo();
let server: Server;
let baseUrl: string;
let customers: MongoCustomerRepository;

before(async () => {
  await mongo.start();
  const db = await mongo.freshDb();
  customers = new MongoCustomerRepository(db);
  const telegram = new FakeTelegram();
  const bot = createBot({
    token: TEST_TOKEN,
    salon: testSalon,
    customers,
    processedUpdates: new MongoProcessedUpdateRepository(db),
    logger: silentLogger,
    profilePhotoRefreshHours: 24,
    botInfo,
    client: { fetch: telegram.fetch },
  });
  server = createWebhookServer(bot, PATH, SECRET, silentLogger);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  await mongo.stop();
});

function post(secret: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return fetch(`${baseUrl}${PATH}`, { method: "POST", headers, body: JSON.stringify(messageUpdate("/start")) });
}

describe("webhook server", () => {
  it("rejects requests with a wrong or missing secret token", async () => {
    assert.equal((await post("wrong-secret")).status, 401);
    assert.equal((await post(null)).status, 401);
    assert.equal(await customers.count(), 0);
  });

  it("accepts updates with the correct secret token", async () => {
    const response = await post(SECRET);
    assert.equal(response.status, 200);
    assert.equal(await customers.count(), 1);
  });

  it("exposes only the webhook and health endpoints", async () => {
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    assert.equal((await fetch(`${baseUrl}${PATH}`)).status, 405);
    assert.equal((await fetch(`${baseUrl}/customers`)).status, 404);
  });
});
