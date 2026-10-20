import { Bot, GrammyError, type ApiClientOptions, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { SalonConfig } from "../config.ts";
import type { CustomerRepository, UpsertResult } from "../db/customerRepository.ts";
import type { ProcessedUpdateRepository } from "../db/processedUpdateRepository.ts";
import { describeError, type Logger } from "../logger.ts";
import { ProfilePhotoService } from "../services/profilePhoto.ts";
import { extractSnapshot, RegistrationService } from "../services/registration.ts";
import { callbacks, deleteConfirmation, mainMenu } from "./keyboards.ts";
import * as messages from "./messages.ts";

export interface BotDependencies {
  readonly token: string;
  readonly salon: SalonConfig;
  readonly customers: CustomerRepository;
  readonly processedUpdates: ProcessedUpdateRepository;
  readonly logger: Logger;
  readonly profilePhotoRefreshHours: number;
  readonly now?: () => Date;
  /** Supplying botInfo skips the getMe call during init (used by tests). */
  readonly botInfo?: UserFromGetMe;
  readonly client?: ApiClientOptions;
}

const COMMAND_PATTERN = /^\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/;

/** A short, PII-free label for the kind of interaction, stored as last_event. */
function eventName(ctx: Context): string {
  if (ctx.callbackQuery !== undefined) return "callback_query";
  const text = ctx.message?.text;
  if (text !== undefined) {
    const command = COMMAND_PATTERN.exec(text)?.[1];
    return command === undefined ? "message" : `command:${command.toLowerCase()}`;
  }
  return "message";
}

export function createBot(deps: BotDependencies): Bot {
  const { salon, customers, processedUpdates, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const botConfig: ConstructorParameters<typeof Bot>[1] = {};
  if (deps.botInfo !== undefined) botConfig.botInfo = deps.botInfo;
  if (deps.client !== undefined) botConfig.client = deps.client;
  const bot = new Bot(deps.token, botConfig);

  const registration = new RegistrationService(customers);
  const photos = new ProfilePhotoService(bot.api, customers, logger, deps.profilePhotoRefreshHours);

  const replyHtml = (ctx: Context, text: string) =>
    ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenu(), link_preview_options: { is_disabled: true } });

  // Duplicate delivery guard: Telegram may resend a webhook update it considers undelivered.
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    let claimed = true;
    try {
      claimed = await processedUpdates.claim(updateId, now());
    } catch (error) {
      // Fail open: answering twice is better than not answering at all.
      logger.error("Could not record processed update", { error: describeError(error) });
    }
    if (!claimed) {
      logger.info("Skipping duplicate update", { updateId });
      return;
    }
    try {
      await next();
    } catch (error) {
      // Telegram rejected a call (e.g. the user blocked the bot). Retrying the
      // update cannot fix that, so it is logged and treated as handled.
      if (error instanceof GrammyError) {
        logger.error("Telegram API error", { error: describeError(error) });
        return;
      }
      try {
        await processedUpdates.release(updateId);
      } catch (releaseError) {
        logger.error("Could not release processed update", { error: describeError(releaseError) });
      }
      throw error;
    }
  });

  bot.command("start", async (ctx) => {
    const extracted = extractSnapshot(ctx.from, ctx.chat);
    if (!extracted.ok) {
      logger.warn("Ignoring /start from unsupported update", { reason: extracted.reason });
      return;
    }

    let result: UpsertResult;
    try {
      result = await registration.register(extracted.snapshot, ctx.match, now());
    } catch (error) {
      logger.error("Customer registration failed", { error: describeError(error) });
      await ctx.reply(messages.genericError);
      return;
    }
    logger.info(result.created ? "Customer registered" : "Customer refreshed", {
      customerId: result.customer.id,
    });

    await replyHtml(ctx, messages.welcome(salon, result.customer.firstName, result.created));

    try {
      await photos.sync(result.customer, now());
    } catch (error) {
      logger.warn("Profile photo sync failed", { error: describeError(error) });
    }
  });

  // Every later interaction refreshes metadata and last_interaction_at of
  // already registered customers. It never creates a record.
  bot.use(async (ctx, next) => {
    const extracted = extractSnapshot(ctx.from, ctx.chat);
    if (extracted.ok) {
      try {
        await registration.recordInteraction(extracted.snapshot, eventName(ctx), now());
      } catch (error) {
        logger.error("Could not record interaction", { error: describeError(error) });
      }
    }
    await next();
  });

  const showServices = (ctx: Context) => replyHtml(ctx, messages.services(salon));
  const showContact = (ctx: Context) => replyHtml(ctx, messages.contact(salon));
  const showPrivacy = (ctx: Context) => replyHtml(ctx, messages.privacy(salon));
  const showHelp = (ctx: Context) => replyHtml(ctx, messages.help(salon));

  const showProfile = async (ctx: Context) => {
    if (ctx.chat?.type !== "private" || ctx.from === undefined) {
      await ctx.reply(messages.privateChatOnly);
      return;
    }
    let customer;
    try {
      customer = await customers.findByTelegramUserId(BigInt(ctx.from.id));
    } catch (error) {
      logger.error("Profile lookup failed", { error: describeError(error) });
      await ctx.reply(messages.genericError);
      return;
    }
    if (customer === null) {
      await ctx.reply(messages.notRegistered);
      return;
    }
    await replyHtml(ctx, messages.profile(customer));
  };

  bot.command("help", showHelp);
  bot.command("services", showServices);
  bot.command("contact", showContact);
  bot.command("privacy", showPrivacy);
  bot.command("profile", showProfile);

  bot.command("delete_my_data", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply(messages.privateChatOnly);
      return;
    }
    await ctx.reply(messages.deleteConfirm, { reply_markup: deleteConfirmation() });
  });

  const menuActions: ReadonlyArray<readonly [string, (ctx: Context) => Promise<unknown>]> = [
    [callbacks.services, showServices],
    [callbacks.contact, showContact],
    [callbacks.profile, showProfile],
    [callbacks.privacy, showPrivacy],
    [callbacks.help, showHelp],
  ];
  for (const [data, action] of menuActions) {
    bot.callbackQuery(data, async (ctx) => {
      await ctx.answerCallbackQuery();
      await action(ctx);
    });
  }

  bot.callbackQuery(callbacks.confirmDelete, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") {
      await ctx.reply(messages.privateChatOnly);
      return;
    }
    let deleted: boolean;
    try {
      deleted = await customers.deleteByTelegramUserId(BigInt(ctx.from.id));
    } catch (error) {
      logger.error("Customer deletion failed", { error: describeError(error) });
      await ctx.reply(messages.genericError);
      return;
    }
    logger.info(deleted ? "Customer data deleted" : "Deletion requested by unknown user");
    await ctx.editMessageText(deleted ? messages.deleteDone : messages.deleteNothing);
  });

  bot.callbackQuery(callbacks.cancelDelete, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(messages.deleteCancelled);
  });

  bot.on("callback_query", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.chatType("private").on("message", async (ctx) => {
    await replyHtml(ctx, messages.unknownInput);
  });

  bot.catch((error) => {
    logger.error("Unhandled bot error", { error: describeError(error.error) });
  });

  return bot;
}
