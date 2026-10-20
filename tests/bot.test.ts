import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { User } from "grammy/types";
import { callbacks, languageCallback } from "../src/bot/keyboards.ts";
import * as messages from "../src/bot/messages.ts";
import { MongoCustomerRepository } from "../src/db/customerRepository.ts";
import type { Lang } from "../src/i18n.ts";
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
const en = messages.t("en");

/** Registers the default user and picks a language, then forgets the calls made so far. */
async function registered(lang: Lang = "en", options: Parameters<typeof setup>[1] = {}): Promise<TestContext> {
  const ctx = await context(options);
  await ctx.send(messageUpdate("/start"));
  await ctx.send(callbackUpdate(languageCallback(lang)));
  ctx.telegram.calls.length = 0;
  return ctx;
}

describe("/start registration", () => {
  it("registers a new user and asks for a language", async () => {
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
    assert.equal(customer.preferredLanguage, null);
    assert.deepEqual(customer.registeredAt, ctx.clock.now);

    const [prompt] = ctx.telegram.callsTo("sendMessage");
    assert.equal(prompt?.payload.text, messages.LANGUAGE_PROMPT);
    const keyboard = JSON.stringify(prompt.payload.reply_markup);
    for (const lang of ["hy", "ru", "en"] as const) assert.ok(keyboard.includes(languageCallback(lang)));
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
  });

  it("does not create duplicates and greets returning users in their language", async () => {
    const ctx = await registered("ru");
    const registeredAt = (await ctx.customers.findByTelegramUserId(userId))?.registeredAt;
    ctx.clock.now = new Date("2026-01-05T09:00:00.000Z");
    await ctx.send(messageUpdate("/start"));

    assert.equal(await ctx.customers.count(), 1);
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.ok(customer);
    assert.deepEqual(customer.registeredAt, registeredAt);
    assert.deepEqual(customer.lastInteractionAt, ctx.clock.now);
    assert.match(ctx.telegram.sentTexts()[0] ?? "", /Рады снова вас видеть, Anna!/);
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

  it("replies with a friendly error in the user's language when the database fails", async () => {
    const ctx = await context({
      customers: (db) => {
        const real = new MongoCustomerRepository(db);
        return {
          registerOrUpdate: () => Promise.reject(new Error("connection lost")),
          touchIfRegistered: () => Promise.reject(new Error("connection lost")),
          findByTelegramUserId: () => Promise.reject(new Error("connection lost")),
          setPreferredLanguage: () => Promise.reject(new Error("connection lost")),
          updateProfilePhoto: (...args) => real.updateProfilePhoto(...args),
          deleteByTelegramUserId: () => Promise.reject(new Error("connection lost")),
          count: () => real.count(),
        };
      },
    });
    await ctx.send(messageUpdate("/start"));
    await ctx.send(messageUpdate("/delete_my_data"));
    await ctx.send(callbackUpdate(callbacks.confirmDelete));
    const texts = ctx.telegram.sentTexts();
    assert.equal(texts[0], en.genericError);
    assert.equal(texts.at(-1), en.genericError);
  });

  it("ignores /start from bot accounts", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start", { from: { ...defaultUser, is_bot: true } }));
    assert.equal(await ctx.customers.count(), 0);
  });
});

describe("languages", () => {
  for (const [lang, greeting] of [
    ["hy", /Բարի գալուստ <b>Test Salon<\/b>, Anna։/],
    ["ru", /Добро пожаловать в <b>Test Salon<\/b>, Anna!/],
    ["en", /Welcome to <b>Test Salon<\/b>, Anna!/],
  ] as const) {
    it(`saves ${lang} as the chosen language and answers in it`, async () => {
      const ctx = await context();
      await ctx.send(messageUpdate("/start"));
      await ctx.send(callbackUpdate(languageCallback(lang)));

      assert.equal((await ctx.customers.findByTelegramUserId(userId))?.preferredLanguage, lang);
      assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, messages.t(lang).languageChosen);
      const welcome = ctx.telegram.callsTo("sendMessage").at(-1);
      assert.match(String(welcome?.payload.text), greeting);
      assert.ok(JSON.stringify(welcome?.payload.reply_markup).includes(messages.t(lang).buttons.services));

      const chatCommands = ctx.telegram.callsTo("setMyCommands")[0]?.payload;
      assert.deepEqual(chatCommands?.scope, { type: "chat", chat_id: defaultUser.id });

      ctx.telegram.calls.length = 0;
      await ctx.send(messageUpdate("/help"));
      assert.equal(ctx.telegram.sentTexts()[0], messages.help(lang, testSalon));
    });
  }

  it("lets users change the language later", async () => {
    const ctx = await registered("en");
    await ctx.send(messageUpdate("/language"));
    assert.equal(ctx.telegram.sentTexts()[0], messages.LANGUAGE_PROMPT);
    await ctx.send(callbackUpdate(callbacks.language));
    assert.equal(ctx.telegram.sentTexts()[1], messages.LANGUAGE_PROMPT);
    await ctx.send(callbackUpdate(languageCallback("hy")));
    assert.equal((await ctx.customers.findByTelegramUserId(userId))?.preferredLanguage, "hy");
    await ctx.send(messageUpdate("/services"));
    assert.match(ctx.telegram.sentTexts().at(-1) ?? "", /Մանիկյուր/);
  });

  it("uses Telegram's app language before a choice is made", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/contact", { from: { ...defaultUser, language_code: "ru" } }));
    assert.match(ctx.telegram.sentTexts()[0] ?? "", /\[Адрес\]/);
    await ctx.send(messageUpdate("/contact", { from: { ...defaultUser, language_code: "de" } }));
    assert.match(ctx.telegram.sentTexts()[1] ?? "", /\[Հասցե\]/);
  });

  it("ignores unknown language buttons", async () => {
    const ctx = await registered("en");
    await ctx.send(callbackUpdate("lang:xx"));
    assert.equal((await ctx.customers.findByTelegramUserId(userId))?.preferredLanguage, "en");
  });

  it("has every text in every language", () => {
    for (const lang of ["hy", "ru", "en"] as const) {
      const text = messages.t(lang);
      for (const value of Object.values(text.buttons)) assert.ok(value.length > 0);
      assert.equal(messages.commandList(lang).length, messages.COMMANDS.length);
      for (const { description } of messages.commandList(lang)) assert.ok(description.length >= 3);
    }
  });
});

describe("interactions", () => {
  it("does not register users who only send messages or press buttons", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("hello"));
    await ctx.send(messageUpdate("/help"));
    await ctx.send(callbackUpdate(callbacks.services));
    await ctx.send(callbackUpdate(languageCallback("ru")));
    assert.equal(await ctx.customers.count(), 0);
  });

  it("updates last interaction for registered users", async () => {
    const ctx = await registered();
    ctx.clock.now = new Date("2026-02-01T00:00:00.000Z");
    await ctx.send(messageUpdate("/services"));
    const customer = await ctx.customers.findByTelegramUserId(userId);
    assert.deepEqual(customer?.lastInteractionAt, ctx.clock.now);
    assert.equal(customer.lastEvent, "command:services");
  });

  it("answers informational commands", async () => {
    const ctx = await registered("en");
    for (const command of ["/help", "/services", "/contact", "/privacy"]) {
      await ctx.send(messageUpdate(command));
    }
    const [help, services, contact, privacy] = ctx.telegram.sentTexts();
    assert.equal(help, messages.help("en", testSalon));
    assert.match(services ?? "", /Service A<\/b> — \[price\] · 60 min/);
    assert.match(contact ?? "", /\[Placeholder address\]/);
    assert.match(privacy ?? "", /do <b>not<\/b> ask for or store phone numbers, birthdays or your Telegram bio/);
  });

  it("shows a price note when services have no price", async () => {
    const ctx = await registered("hy");
    await ctx.send(messageUpdate("/services"));
    const text = ctx.telegram.sentTexts()[0] ?? "";
    assert.match(text, /• <b>Մանիկյուր<\/b>\n/);
    assert.ok(text.endsWith(messages.t("hy").priceNote));
  });

  it("handles main menu buttons", async () => {
    const ctx = await registered("en");
    await ctx.send(callbackUpdate(callbacks.contact));
    assert.equal(ctx.telegram.callsTo("answerCallbackQuery").length, 1);
    assert.equal(ctx.telegram.sentTexts()[0], messages.contact("en", testSalon));
  });

  it("never asks for phone numbers, birthdays or bios", async () => {
    const ctx = await context();
    await ctx.send(messageUpdate("/start"));
    for (const lang of ["hy", "ru", "en"] as const) {
      await ctx.send(callbackUpdate(languageCallback(lang)));
      for (const command of ["/help", "/services", "/contact", "/privacy", "/delete_my_data"]) {
        await ctx.send(messageUpdate(command));
      }
    }
    const payloads = JSON.stringify(ctx.telegram.calls.map((call) => call.payload));
    assert.ok(!payloads.includes("request_contact"));
    assert.ok(!/enter your (phone|birthday|date of birth)/i.test(payloads));
    assert.ok(!ctx.telegram.calls.some((call) => call.method === "getChat"));
  });
});

describe("stored data stays hidden from users", () => {
  it("never shows stored profile data in any reply", async () => {
    const ctx = await registered("en");
    for (const input of ["/profile", "/help", "/services", "/contact", "/privacy", "hello"]) {
      await ctx.send(messageUpdate(input));
    }
    await ctx.send(callbackUpdate("menu:profile"));
    assert.equal((await ctx.customers.findByTelegramUserId(userId))?.username, "anna_s");
    for (const text of ctx.telegram.sentTexts()) {
      assert.ok(!text.includes(String(defaultUser.id)));
      assert.ok(!text.includes("anna_s"));
      assert.ok(!text.includes("Smith"));
    }
  });

  it("has no profile button or command", async () => {
    const ctx = await registered("en");
    await ctx.send(messageUpdate("/start"));
    const menu = JSON.stringify(ctx.telegram.callsTo("sendMessage")[0]?.payload.reply_markup);
    assert.ok(!menu.includes("profile"));
    assert.ok(!messages.COMMANDS.some((command) => command.includes("profile")));
    await ctx.send(messageUpdate("/profile"));
    assert.equal(ctx.telegram.sentTexts().at(-1), en.unknownInput);
  });
});

describe("/delete_my_data", () => {
  it("deletes the customer after confirmation", async () => {
    const ctx = await registered("ru");
    await ctx.send(messageUpdate("/delete_my_data"));
    assert.equal(ctx.telegram.sentTexts()[0], messages.t("ru").deleteConfirm);
    assert.equal(await ctx.customers.count(), 1);

    await ctx.send(callbackUpdate(callbacks.confirmDelete));
    assert.equal(await ctx.customers.count(), 0);
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, messages.t("ru").deleteDone);
    assert.equal(ctx.telegram.callsTo("deleteMyCommands").length, 1);

    // Later interactions must not silently recreate the record.
    await ctx.send(messageUpdate("/help"));
    await ctx.send(messageUpdate("hello"));
    assert.equal(await ctx.customers.count(), 0);
  });

  it("keeps data when deletion is cancelled", async () => {
    const ctx = await registered("en");
    await ctx.send(callbackUpdate(callbacks.cancelDelete));
    assert.equal(await ctx.customers.count(), 1);
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, en.deleteCancelled);
  });

  it("tells unknown users there is nothing to delete", async () => {
    const ctx = await context();
    await ctx.send(callbackUpdate(callbacks.confirmDelete));
    assert.equal(ctx.telegram.callsTo("editMessageText")[0]?.payload.text, en.deleteNothing);
  });

  it("is only available in private chats", async () => {
    const ctx = await registered("en");
    await ctx.send(messageUpdate("/delete_my_data", { chat: { id: -100555, type: "supergroup", title: "Group" } }));
    assert.equal(ctx.telegram.sentTexts()[0], en.privateChatOnly);
  });
});
