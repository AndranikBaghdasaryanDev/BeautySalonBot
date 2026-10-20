import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "grammy/types";
import { extractSnapshot, registrationSource } from "../src/services/registration.ts";
import { defaultUser, privateChat } from "./helpers.ts";

function snapshotOf(user: User) {
  const result = extractSnapshot(user, privateChat(user));
  assert.ok(result.ok, "expected a valid snapshot");
  return result.snapshot;
}

describe("extractSnapshot", () => {
  it("extracts the Telegram user ID and chat ID losslessly as bigint", () => {
    const snapshot = snapshotOf({ ...defaultUser, id: 9_007_199_254_740_991 });
    assert.equal(snapshot.telegramUserId, 9_007_199_254_740_991n);
    assert.equal(snapshot.telegramChatId, 9_007_199_254_740_991n);
  });

  it("extracts all available fields", () => {
    assert.deepEqual(snapshotOf(defaultUser), {
      telegramUserId: 5_000_000_001n,
      telegramChatId: 5_000_000_001n,
      username: "anna_s",
      firstName: "Anna",
      lastName: "Smith",
      languageCode: "en",
      isBot: false,
      chatType: "private",
      chatTitle: null,
    });
  });

  it("handles a missing username", () => {
    const { username: _omit, ...user } = defaultUser;
    assert.equal(snapshotOf(user).username, null);
  });

  it("handles missing or blank first and last names", () => {
    const { last_name: _omit, ...user } = defaultUser;
    const snapshot = snapshotOf({ ...user, first_name: "   " });
    assert.equal(snapshot.firstName, null);
    assert.equal(snapshot.lastName, null);
  });

  it("handles a missing language code", () => {
    const { language_code: _omit, ...user } = defaultUser;
    assert.equal(snapshotOf(user).languageCode, null);
  });

  it("captures the group title only for non-private chats", () => {
    const result = extractSnapshot(defaultUser, { id: -1001234567890, type: "supergroup", title: "Salon Fans" });
    assert.ok(result.ok);
    assert.equal(result.snapshot.chatTitle, "Salon Fans");
    assert.equal(result.snapshot.chatType, "supergroup");
    assert.equal(result.snapshot.telegramChatId, -1001234567890n);
  });

  it("rejects updates without a user or chat", () => {
    assert.deepEqual(extractSnapshot(undefined, privateChat(defaultUser)), { ok: false, reason: "missing_user" });
    assert.deepEqual(extractSnapshot(defaultUser, undefined), { ok: false, reason: "missing_chat" });
  });

  it("rejects invalid identifiers", () => {
    const result = extractSnapshot({ ...defaultUser, id: 1.5 }, privateChat(defaultUser));
    assert.deepEqual(result, { ok: false, reason: "invalid_id" });
  });

  it("does not register bot accounts", () => {
    const result = extractSnapshot({ ...defaultUser, is_bot: true }, privateChat(defaultUser));
    assert.deepEqual(result, { ok: false, reason: "bot_account" });
  });

  it("only produces fields the Bot API provides (no phone, birthday or bio)", () => {
    const keys = Object.keys(snapshotOf(defaultUser)).map((key) => key.toLowerCase());
    for (const forbidden of ["phone", "birth", "bio", "description"]) {
      assert.ok(!keys.some((key) => key.includes(forbidden)), `unexpected field containing ${forbidden}`);
    }
  });
});

describe("registrationSource", () => {
  it("records deep-link payloads and ignores unsafe ones", () => {
    assert.equal(registrationSource(""), "start");
    assert.equal(registrationSource("instagram_ad"), "start:instagram_ad");
    assert.equal(registrationSource("<script>"), "start");
    assert.equal(registrationSource("x".repeat(65)), "start");
  });
});
