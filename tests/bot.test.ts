import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { User } from "grammy/types";
import { callbacks } from "../src/bot/keyboards.ts";
import * as messages from "../src/bot/messages.ts";
import { MongoCustomerRepository } from "../src/db/customerRepository.ts";
import {
  TEST_TOKEN,
  TestMongo,
  callbackUpdate,
  defaultUser,
  messageUpdate,
  newUpdateId,
  recordingLogger,
  setup,
  testSalon,
  type TestContext,
} from "./helpers.ts";

const mongo = new TestMongo();
before(() => mongo.start());
after(() => mongo.stop());

async function context(options: Parameters<typeof setup>[1] = {}): Promise<TestContext> {
  return setup(await mongo.freshDb(), options);
}

const userId = BigInt(defaultUser.id);

describe("/start registration", () => {
  it("registers a new user and shows the welcome message with the main menu", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));

    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.ok(customer);
    assert.equal(customer.username, "anna_s");
    assert.equal(customer.firstName, "Anna");
    assert.equal(customer.lastName, "Smith");
    assert.equal(customer.languageCode, "en");
    assert.equal(customer.isBot, false);
    assert.equal(customer.chatType, "private");
    assert.equal(customer.telegramChatId, userId);
    assert.equal(customer.registrationSource, "start");
    assert.deepEqual(customer.registeredAt, ctx.clock.now);

    const [welcome] = ctx.telegram.callsTo("sendMessage");
    assert.ok(welcome);
    assert.match(String(welcome.payload.text), /Welcome to <b>Test Salon<\/b>, Anna/);
    assert.equal(welcome.payload.parse_mode, "HTML");
    assert.ok(JSON.stringify(welcome.payload.reply_markup).includes(callbacks.services));
  });

  it("records the deep-link source", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start instagram"));
    assert.equal((await ctx.customers.findByTelegramUserId(userId))?.registrationSource, "start:instagram");
  });

  it("registers users without username, last name or language code", async () => {
    const ctx = await context();
    const minimal: User = { id: 6_000_000_002, is_bot: false, first_name: "Mia" };
    await ctx.send(messageUpdate("/start", { from: minimal }));
    const customer = await ctx.customers.findByTelegramUserId(6_000_000_002n);
    assert.ok(customer);
    assert.equal(customer.username, null);
    assert.equal(customer.lastName, null);
    assert.equal(customer.languageCode, null);
    assert.match(ctx.telegram.sentTexts()[0] ?? "", /Mia/);
  });

  it("does not create duplicates when an existing user presses /start again", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    const registeredAt = ctx.clock.now;
    ctx.clock.now = new Date("2026-01-05T09:00:00.000Z");
    await ctx.send(messageUpdate("/start"));

    assert.equal(await ctx.customers.count(), 1);
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.deepEqual(customer?.registeredAt, registeredAt);
    assert.deepEqual(customer.lastInteractionAt, ctx.clock.now);
    assert.match(ctx.telegram.sentTexts()[1] ?? "", /Welcome back, Anna/);
  });

  it("updates changed profile data and keeps values missing from the update", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    const { username: _u, language_code: _l, ...rest } = defaultUser;
    await ctx.send(messageUpdate("/start", { from: { ...rest, first_name: "Annie" } }));

    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.equal(customer?.firstName, "Annie");
    assert.equal(customer.username, "anna_s");
    assert.equal(customer.languageCode, "en");
  });

  it("handles a redelivered update only once", async () => {
    const ctx = await context();
    const update = messageUpdate("/start", { updateId: newUpdateId() });
    await ctx.send(update);
    await ctx.send(update);
    assert.equal(await ctx.customers.count(), 1);
    assert.equal(ctx.telegram.callsTo("sendMessage").length, 1);
  });

  it("handles concurrent /start updates from the same user", async () => {
    const ctx = await context();
    await Promise.all(Array.from({ length: 10 }, () => ctx.send(messageUpdate("/start"))));
    assert.equal(await ctx.customers.count(), 1);
    assert.equal(ctx.telegram.callsTo("sendMessage").length, 10);
  });

  it("stores profile photo file identifiers and does not refetch them within the refresh window", async () => {
    const ctx = await context();
    ctx.telegram.photos = [[
      { file_id: "small", file_unique_id: "u-small", width: 160, height: 160 },
      { file_id: "large", file_unique_id: "u-large", width: 640, height: 640 },
    ]];
    await ctx.send(messageUpdate("/start"));
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.equal(customer?.profilePhotoFileId, "large");
    assert.equal(customer.profilePhotoFileUniqueId, "u-large");
    assert.equal(ctx.telegram.callsTo("getUserProfilePhotos")[0]?.payload.limit, 1);

    await ctx.send(messageUpdate("/start"));
    assert.equal(ctx.telegram.callsTo("getUserProfilePhotos").length, 1);
    assert.equal(ctx.telegram.calls.some((call) => call.method === "getFile"), false);
  });

  it("handles users without an accessible profile photo", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.equal(customer?.profilePhotoFileId, null);
    assert.ok(customer.profilePhotoCheckedAt);
  });

  it("still registers the user when the profile photo lookup fails", async () => {
    const ctx = await context();
    ctx.telegram.failures.set("getUserProfilePhotos", { code: 500, description: "Internal Server Error" });
    await ctx.send(messageUpdate("/start"));
    assert.equal(await ctx.customers.count(), 1);
    assert.equal(ctx.telegram.callsTo("sendMessage").length, 1);
  });

  it("survives Telegram API errors when replying and does not log secrets or personal data", async () => {
    const logger = recordingLogger();
    const ctx = await context({ logger });
    ctx.telegram.failures.set("sendMessage", { code: 403, description: "Forbidden: bot was blocked by the user" });
    await ctx.send(messageUpdate("/start"));

    assert.equal(await ctx.customers.count(), 1);
    const log = logger.lines.join("\n");
    assert.match(log, /Telegram API error/);
    assert.ok(!log.includes(TEST_TOKEN));
    for (const personal of ["anna_s", "Anna", "Smith", String(defaultUser.id)]) {
      assert.ok(!log.includes(personal), `log contains ${personal}`);
    }
  });

  it("lets non-Telegram failures propagate so the update can be retried", async () => {
    const ctx = await context();
    ctx.telegram.networkDown = true;
    const update = messageUpdate("/start");
    await assert.rejects(ctx.send(update), /Network request for 'sendMessage' failed/);
    // The duplicate guard released the claim, so a redelivery is processed again.
    ctx.telegram.networkDown = false;
    await ctx.send(update);
    assert.equal(ctx.telegram.callsTo("sendMessage").length, 1);
  });

  it("replies with a friendly error when the database fails", async () => {
    const ctx = await context({
      customers: (db) => {
        const real = new MongoCustomerRepository(db);
        return {
          registerOrUpdate: () => Promise.reject(new Error("connection lost")),
          touchIfRegistered: () => Promise.reject(new Error("connection lost")),
          findByTelegramUserId: () => Promise.reject(new Error("connection lost")),
          updateProfilePhoto: (...args) => real.updateProfilePhoto(...args),
          deleteByTelegramUserId: () => Promise.reject(new Error("connection lost")),
          count: () => real.count(),
        };
      },
    });
    await ctx.send(messageUpdate("/start"));
    await ctx.send(messageUpdate("/profile"));
    assert.deepEqual(ctx.telegram.sentTexts(), [messages.genericError, messages.genericError]);
  });

  it("ignores /start from bot accounts", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start", { from: { ...defaultUser, is_bot: true } }));
    assert.equal(await ctx.customers.count(), 0);
  });
});

describe("interactions", () => {
  it("does not register users who only send messages", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("hello"));
    await ctx.send(messageUpdate("/help"));
    await ctx.send(callbackUpdate(callbacks.services));
    assert.equal(await ctx.customers.count(), 0);
  });

  it("updates last interaction for registered users", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    ctx.clock.now = new Date("2026-02-01T00:00:00.000Z");
    await ctx.send(messageUpdate("/services"));
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.deepEqual(customer?.lastInteractionAt, ctx.clock.now);
    assert.equal(customer.lastEvent, "command:services");
  });

  it("answers informational commands", async () => {
    const ctx = await context();
    for (const command of ["/help", "/services", "/contact", "/privacy"]) {
      await ctx.send(messageUpdate(command));
    }
    const [help, services, contact, privacy] = ctx.telegram.sentTexts();
    assert.equal(help, messages.help(testSalon));
    assert.match(services ?? "", /Service A/);
    assert.match(contact ?? "", /\[Placeholder address\]/);
    assert.match(privacy ?? "", /do <b>not<\/b> ask for or store phone numbers, birthdays or your Telegram bio/);
  });

  it("handles main menu buttons", async () => {
    const ctx = await context();
    await ctx.send(callbackUpdate(callbacks.contact));
    assert.equal(ctx.telegram.callsTo("answerCallbackQuery").length, 1);
    assert.equal(ctx.telegram.sentTexts()[0], messages.contact(testSalon));
  });

  it("never asks for phone numbers, birthdays or bios", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    for (const command of ["/help", "/services", "/contact", "/privacy", "/profile", "/delete_my_data"]) {
      await ctx.send(messageUpdate(command));
    }
    const payloads = JSON.stringify(ctx.telegram.calls.map((call) => call.payload));
    assert.ok(!payloads.includes("request_contact"));
    assert.ok(!/enter your (phone|birthday|date of birth)/i.test(payloads));
    assert.ok(!ctx.telegram.calls.some((call) => call.method === "getChat"));
  });
});

describe("/profile", () => {
  it("shows stored information to the registered user", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    await ctx.send(messageUpdate("/profile"));
    const text = ctx.telegram.sentTexts()[1] ?? "";
    assert.match(text, /Telegram ID: 5000000001/);
    assert.match(text, /Username: @anna_s/);
    assert.match(text, /Language: en/);
    assert.match(text, /Registered: 2026-01-01 10:00 UTC/);
    assert.doesNotMatch(text, /phone|birth/i);
  });

  it("escapes HTML in names", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start", { from: { ...defaultUser, first_name: "<b>x</b>" } }));
    await ctx.send(messageUpdate("/profile", { from: { ...defaultUser, first_name: "<b>x</b>" } }));
    assert.match(ctx.telegram.sentTexts()[1] ?? "", /First name: &lt;b&gt;x&lt;\/b&gt;/);
  });

  it("asks unregistered users to press /start", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/profile"));
    assert.deepEqual(ctx.telegram.sentTexts(), [messages.notRegistered]);
  });

  it("does not reveal profile data in group chats", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    await ctx.send(messageUpdate("/profile", { chat: { id: -100555, type: "supergroup", title: "Group" } }));
    assert.equal(ctx.telegram.sentTexts()[1], messages.privateChatOnly);
  });
});

describe("/delete_my_data", () => {
  it("deletes the customer after confirmation", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    await ctx.send(messageUpdate("/delete_my_data"));
    assert.equal(ctx.telegram.sentTexts()[1], messages.deleteConfirm);
    assert.equal(await ctx.customers.count(), 1);

    await ctx.send(callbackUpdate(callbacks.confirmDelete));
    assert.equal(await ctx.customers.count(), 0);
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, messages.deleteDone);

    // Later interactions must not silently recreate the record.
    await ctx.send(messageUpdate("/help"));
    await ctx.send(messageUpdate("/profile"));
    assert.equal(await ctx.customers.count(), 0);
    assert.equal(ctx.telegram.sentTexts().at(-1), messages.notRegistered);
  });

  it("keeps data when deletion is cancelled", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    await ctx.send(callbackUpdate(callbacks.cancelDelete));
    assert.equal(await ctx.customers.count(), 1);
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, messages.deleteCancelled);
  });

  it("tells unknown users there is nothing to delete", async () => {
    const ctx = await context();
    await ctx.send(callbackUpdate(callbacks.confirmDelete));
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, messages.deleteNothing);
  });
});
