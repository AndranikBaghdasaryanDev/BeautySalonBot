import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig, parseServices } from "../src/config.ts";
import { TEST_TOKEN } from "./helpers.ts";

const validEnv = {
  TELEGRAM_BOT_TOKEN: TEST_TOKEN,
  MONGODB_URI: "mongodb+srv://user:pass@cluster0.example.mongodb.net/?retryWrites=true",
  BEAUTY_SALON_NAME: "Salon",
  BEAUTY_SALON_ADDRESS: "[address]",
  BEAUTY_SALON_CONTACT: "[contact]",
};

describe("loadConfig", () => {
  it("loads a minimal polling configuration", () => {
    const config = loadConfig(validEnv);
    assert.equal(config.mode, "polling");
    assert.equal(config.webhook, null);
    assert.equal(config.mongo.dbName, "beauty_salon");
    assert.deepEqual(config.salon.services, []);
  });

  it("requires the bot token, MongoDB URI and salon details", () => {
    for (const key of Object.keys(validEnv)) {
      assert.throws(() => loadConfig({ ...validEnv, [key]: "" }), ConfigError);
    }
  });

  it("rejects malformed tokens and URIs without echoing them", () => {
    assert.throws(() => loadConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: "not-a-token" }), (error: unknown) => {
      return error instanceof ConfigError && !error.message.includes("not-a-token");
    });
    assert.throws(() => loadConfig({ ...validEnv, MONGODB_URI: "postgres://x" }), ConfigError);
  });

  it("validates webhook settings", () => {
    const webhookEnv = { ...validEnv, BOT_MODE: "webhook", TELEGRAM_WEBHOOK_URL: "https://bot.example.com/tg/hook" };
    assert.throws(() => loadConfig(webhookEnv), /TELEGRAM_WEBHOOK_SECRET/);
    assert.throws(() => loadConfig({ ...webhookEnv, TELEGRAM_WEBHOOK_SECRET: "short" }), ConfigError);
    assert.throws(
      () => loadConfig({ ...webhookEnv, TELEGRAM_WEBHOOK_URL: "http://insecure", TELEGRAM_WEBHOOK_SECRET: "a".repeat(32) }),
      /https/,
    );
    const config = loadConfig({ ...webhookEnv, TELEGRAM_WEBHOOK_SECRET: "a".repeat(32) });
    assert.equal(config.webhook?.path, "/tg/hook");
    assert.equal(config.webhook.port, 8080);
  });
});

describe("parseServices", () => {
  it("parses name|price|duration entries", () => {
    assert.deepEqual(parseServices("Cut|[price]|45 min; Colour|[price]"), [
      { name: "Cut", price: "[price]", duration: "45 min" },
      { name: "Colour", price: "[price]", duration: null },
    ]);
  });

  it("rejects incomplete entries", () => {
    assert.throws(() => parseServices("OnlyName"), ConfigError);
  });
});
