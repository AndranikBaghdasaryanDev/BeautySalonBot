import { Bot, GrammyError, type ApiClientOptions, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { SalonConfig } from "../config.ts";
import type { Customer, CustomerRepository, UpsertResult } from "../db/customerRepository.ts";
import type { ProcessedUpdateRepository } from "../db/processedUpdateRepository.ts";
import { detectLanguage, type Lang } from "../i18n.ts";
import { describeError, type Logger } from "../logger.ts";
import { ProfilePhotoService } from "../services/profilePhoto.ts";
import { extractSnapshot, RegistrationService } from "../services/registration.ts";
import { registerChatCommands } from "./commands.ts";
import {
  callbacks,
  deleteConfirmation,
  languageMenu,
  mainMenu,
  parseLanguageCallback,
} from "./keyboards.ts";
import * as messages from "./messages.ts";

/** Context with the language every reply in this update should use. */
export type BotContext = Context & { lang: Lang };

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

export function createBot(deps: BotDependencies): Bot<BotContext> {
  const { salon, customers, processedUpdates, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const botConfig: ConstructorParameters<typeof Bot<BotContext>>[1] = {};
  if (deps.botInfo !== undefined) botConfig.botInfo = deps.botInfo;
  if (deps.client !== undefined) botConfig.client = deps.client;
  const bot = new Bot<BotContext>(deps.token, botConfig);

  const registration = new RegistrationService(customers);
  const photos = new ProfilePhotoService(bot.api, customers, logger, deps.profilePhotoRefreshHours);

  const languageOf = (customer: Customer | null, ctx: Context): Lang =>
    customer?.preferredLanguage ?? detectLanguage(ctx.from?.language_code, salon.defaultLanguage);

  const replyHtml = (ctx: BotContext, text: string) =>
    ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: mainMenu(ctx.lang),
      link_preview_options: { is_disabled: true },
    });

  const askLanguage = (ctx: BotContext) => ctx.reply(messages.LANGUAGE_PROMPT, { reply_markup: languageMenu() });

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

  // Until the stored preference is known, use the language of the Telegram app.
  bot.use(async (ctx, next) => {
    ctx.lang = languageOf(null, ctx);
    await next();
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
      await ctx.reply(messages.t(ctx.lang).genericError);
      return;
    }
    logger.info(result.created ? "Customer registered" : "Customer refreshed", {
      customerId: result.customer.id,
    });

    if (result.customer.preferredLanguage === null) {
      await askLanguage(ctx);
    } else {
      ctx.lang = result.customer.preferredLanguage;
      await replyHtml(ctx, messages.welcome(ctx.lang, salon, result.customer.firstName, false));
    }

    try {
      await photos.sync(result.customer, now());
    } catch (error) {
      logger.warn("Profile photo sync failed", { error: describeError(error) });
    }
  });

  // Every later interaction refreshes metadata and last_interaction_at of
  // already registered customers, and loads their language. It never creates a record.
  bot.use(async (ctx, next) => {
    const extracted = extractSnapshot(ctx.from, ctx.chat);
    if (extracted.ok) {
      try {
        const customer = await registration.recordInteraction(extracted.snapshot, eventName(ctx), now());
        ctx.lang = languageOf(customer, ctx);
      } catch (error) {
        logger.error("Could not record interaction", { error: describeError(error) });
      }
    }
    await next();
  });

  const showServices = (ctx: BotContext) => replyHtml(ctx, messages.services(ctx.lang, salon));
  const showContact = (ctx: BotContext) => replyHtml(ctx, messages.contact(ctx.lang, salon));
  const showPrivacy = (ctx: BotContext) => replyHtml(ctx, messages.privacy(ctx.lang, salon));
  const showHelp = (ctx: BotContext) => replyHtml(ctx, messages.help(ctx.lang, salon));

  bot.command("help", showHelp);
  bot.command("services", showServices);
  bot.command("contact", showContact);
  bot.command("privacy", showPrivacy);
  bot.command("language", askLanguage);

  bot.command("delete_my_data", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply(messages.t(ctx.lang).privateChatOnly);
      return;
    }
    await ctx.reply(messages.t(ctx.lang).deleteConfirm, { reply_markup: deleteConfirmation(ctx.lang) });
  });

  const menuActions: ReadonlyArray<readonly [string, (ctx: BotContext) => Promise<unknown>]> = [
    [callbacks.services, showServices],
    [callbacks.contact, showContact],
    [callbacks.privacy, showPrivacy],
    [callbacks.help, showHelp],
    [callbacks.language, askLanguage],
  ];
  for (const [data, action] of menuActions) {
    bot.callbackQuery(data, async (ctx) => {
      await ctx.answerCallbackQuery();
      await action(ctx);
    });
  }

  bot.callbackQuery(/^lang:/, async (ctx) => {
    const lang = parseLanguageCallback(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (lang === null) return;

    let saved = false;
    try {
      saved = await customers.setPreferredLanguage(BigInt(ctx.from.id), lang, now());
    } catch (error) {
      logger.error("Saving language failed", { error: describeError(error) });
    }
    ctx.lang = lang;

    await ctx.editMessageText(messages.t(lang).languageChosen);
    if (saved && ctx.chat?.type === "private") {
      try {
        await registerChatCommands(ctx.api, ctx.chat.id, lang);
      } catch (error) {
        logger.warn("Could not set chat commands", { error: describeError(error) });
      }
    }
    await replyHtml(ctx, messages.welcome(lang, salon, ctx.from.first_name, true));
  });

  bot.callbackQuery(callbacks.confirmDelete, async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = messages.t(ctx.lang);
    if (ctx.chat?.type !== "private") {
      await ctx.reply(text.privateChatOnly);
      return;
    }
    let deleted: boolean;
    try {
      deleted = await customers.deleteByTelegramUserId(BigInt(ctx.from.id));
    } catch (error) {
      logger.error("Customer deletion failed", { error: describeError(error) });
      await ctx.reply(text.genericError);
      return;
    }
    logger.info(deleted ? "Customer data deleted" : "Deletion requested by unknown user");
    await ctx.editMessageText(deleted ? text.deleteDone : text.deleteNothing);
    if (deleted) {
      try {
        // Drop the per-chat command menu that stored the language choice.
        await ctx.api.deleteMyCommands({ scope: { type: "chat", chat_id: ctx.chat.id } });
      } catch (error) {
        logger.warn("Could not reset chat commands", { error: describeError(error) });
      }
    }
  });

  bot.callbackQuery(callbacks.cancelDelete, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(messages.t(ctx.lang).deleteCancelled);
  });

  bot.on("callback_query", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.chatType("private").on("message", async (ctx) => {
    await replyHtml(ctx, messages.t(ctx.lang).unknownInput);
  });

  bot.catch((error) => {
    logger.error("Unhandled bot error", { error: describeError(error.error) });
  });

  return bot;
}
