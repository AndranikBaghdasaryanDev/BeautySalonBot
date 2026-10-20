import type { Api } from "grammy";
import type { Lang } from "../i18n.ts";
import { commandList } from "./messages.ts";

/**
 * Registers the command menu: Armenian by default, Russian and English for
 * users whose Telegram app uses those languages.
 */
export async function registerCommands(api: Api): Promise<void> {
  await api.setMyCommands(commandList("hy"));
  await api.setMyCommands(commandList("ru"), { language_code: "ru" });
  await api.setMyCommands(commandList("en"), { language_code: "en" });
}

/** Shows the command menu in the language a user picked, in their private chat only. */
export async function registerChatCommands(api: Api, chatId: number, lang: Lang): Promise<void> {
  await api.setMyCommands(commandList(lang), { scope: { type: "chat", chat_id: chatId } });
}
