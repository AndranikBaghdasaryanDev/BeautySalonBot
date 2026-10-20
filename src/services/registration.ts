import type { Chat, User } from "grammy/types";
import type { CustomerRepository, TelegramProfileSnapshot, UpsertResult } from "../db/customerRepository.ts";

export type SnapshotResult =
  | { readonly ok: true; readonly snapshot: TelegramProfileSnapshot }
  | { readonly ok: false; readonly reason: "missing_user" | "missing_chat" | "invalid_id" | "bot_account" };

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isTelegramId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value !== 0;
}

/**
 * Builds a snapshot strictly from fields present in the Telegram update.
 * Absent optional fields become null; nothing is guessed or fabricated.
 */
export function extractSnapshot(from: User | undefined, chat: Chat | undefined): SnapshotResult {
  if (from === undefined) return { ok: false, reason: "missing_user" };
  if (chat === undefined) return { ok: false, reason: "missing_chat" };
  if (!isTelegramId(from.id) || from.id < 0 || !isTelegramId(chat.id)) {
    return { ok: false, reason: "invalid_id" };
  }
  // Bot accounts (e.g. anonymous group admins) are not salon customers.
  if (from.is_bot) return { ok: false, reason: "bot_account" };

  return {
    ok: true,
    snapshot: {
      telegramUserId: BigInt(from.id),
      telegramChatId: BigInt(chat.id),
      username: nonEmpty(from.username),
      firstName: nonEmpty(from.first_name),
      lastName: nonEmpty(from.last_name),
      languageCode: nonEmpty(from.language_code),
      isBot: from.is_bot,
      chatType: chat.type,
      chatTitle: chat.type === "private" ? null : nonEmpty(chat.title),
    },
  };
}

const START_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Describes how the user reached the bot, e.g. "start" or "start:instagram" for deep links. */
export function registrationSource(startPayload: string): string {
  const payload = startPayload.trim();
  return START_PAYLOAD_PATTERN.test(payload) ? `start:${payload}` : "start";
}

export class RegistrationService {
  private readonly customers: CustomerRepository;

  constructor(customers: CustomerRepository) {
    this.customers = customers;
  }

  register(snapshot: TelegramProfileSnapshot, startPayload: string, at: Date): Promise<UpsertResult> {
    return this.customers.registerOrUpdate(snapshot, registrationSource(startPayload), "start_command", at);
  }

  recordInteraction(snapshot: TelegramProfileSnapshot, event: string, at: Date): Promise<boolean> {
    return this.customers.touchIfRegistered(snapshot, event, at);
  }
}
