import { InlineKeyboard } from "grammy";
import { LANGUAGES, isLang, type Lang } from "../i18n.ts";
import { LANGUAGE_LABELS, t } from "./messages.ts";

export const callbacks = {
  services: "menu:services",
  contact: "menu:contact",
  privacy: "menu:privacy",
  help: "menu:help",
  language: "menu:language",
  confirmDelete: "delete:confirm",
  cancelDelete: "delete:cancel",
} as const;

const LANGUAGE_PREFIX = "lang:";

export function languageCallback(lang: Lang): string {
  return `${LANGUAGE_PREFIX}${lang}`;
}

export function parseLanguageCallback(data: string): Lang | null {
  if (!data.startsWith(LANGUAGE_PREFIX)) return null;
  const lang = data.slice(LANGUAGE_PREFIX.length);
  return isLang(lang) ? lang : null;
}

export function mainMenu(lang: Lang): InlineKeyboard {
  const labels = t(lang).buttons;
  return new InlineKeyboard()
    .text(labels.services, callbacks.services)
    .text(labels.contact, callbacks.contact)
    .row()
    .text(labels.language, callbacks.language)
    .text(labels.help, callbacks.help)
    .row()
    .text(labels.privacy, callbacks.privacy);
}

export function languageMenu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const lang of LANGUAGES) {
    keyboard.text(LANGUAGE_LABELS[lang], languageCallback(lang));
  }
  return keyboard;
}

export function deleteConfirmation(lang: Lang): InlineKeyboard {
  const labels = t(lang).buttons;
  return new InlineKeyboard()
    .text(labels.confirmDelete, callbacks.confirmDelete)
    .text(labels.cancelDelete, callbacks.cancelDelete);
}
