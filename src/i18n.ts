export const LANGUAGES = ["hy", "ru", "en"] as const;

export type Lang = (typeof LANGUAGES)[number];

/** A value given separately for every supported language. */
export type Localized<T> = Readonly<Record<Lang, T>>;

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

const RUSSIAN_SPEAKING = new Set(["ru", "uk", "be", "kk", "ky", "uz", "tg"]);

/**
 * Maps Telegram's app language (from.language_code) to a supported language.
 * Telegram has no official Armenian interface, so most Armenian users report
 * "ru" or "en"; that is why the bot also asks for an explicit choice.
 */
export function detectLanguage(languageCode: string | null | undefined, fallback: Lang): Lang {
  const base = languageCode?.toLowerCase().split("-")[0];
  if (base === undefined || base === "") return fallback;
  if (base === "hy") return "hy";
  if (base === "en") return "en";
  if (RUSSIAN_SPEAKING.has(base)) return "ru";
  return fallback;
}
