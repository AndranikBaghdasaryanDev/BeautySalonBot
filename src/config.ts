import { LANGUAGES, isLang, type Lang, type Localized } from "./i18n.ts";

export type BotMode = "polling" | "webhook";

export interface SalonService {
  readonly name: string;
  readonly price: string | null;
  readonly duration: string | null;
}

export interface SalonConfig {
  readonly name: string;
  readonly contact: Localized<string>;
  readonly address: Localized<string>;
  readonly workingHours: Localized<string | null>;
  readonly services: Localized<readonly SalonService[]>;
  /** Used until the user picks a language, when Telegram's language is unsupported. */
  readonly defaultLanguage: Lang;
}

export interface WebhookConfig {
  readonly url: string;
  readonly secret: string;
  readonly path: string;
  readonly port: number;
  readonly host: string;
}

export interface MongoConfig {
  readonly uri: string;
  readonly dbName: string;
}

export interface AppConfig {
  readonly botToken: string;
  readonly mode: BotMode;
  readonly webhook: WebhookConfig | null;
  readonly mongo: MongoConfig;
  readonly profilePhotoRefreshHours: number;
  readonly salon: SalonConfig;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;
// Telegram only accepts 1-256 characters A-Z, a-z, 0-9, "_" and "-" for secret_token.
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

function optional(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? null : value;
}

function required(env: Env, key: string): string {
  const value = optional(env, key);
  if (value === null) {
    throw new ConfigError(`Missing required environment variable ${key}`);
  }
  return value;
}

function positiveInteger(env: Env, key: string, fallback: number): number {
  const raw = optional(env, key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer`);
  }
  return value;
}

/**
 * Parses a services list. Entries are separated by ";" and each entry is
 * "name|price|duration" where price and duration are optional.
 */
export function parseServices(raw: string | null): SalonService[] {
  if (raw === null) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [name = "", price = "", duration = ""] = entry.split("|").map((part) => part.trim());
      if (name === "") {
        throw new ConfigError(`Invalid services entry "${entry}". Expected "name|price|duration"`);
      }
      return { name, price: price === "" ? null : price, duration: duration === "" ? null : duration };
    });
}

/**
 * Reads KEY_HY / KEY_RU / KEY_EN, falling back to KEY for languages without
 * their own value.
 */
function localized(env: Env, key: string): Localized<string | null> {
  const base = optional(env, key);
  const result: Record<Lang, string | null> = { hy: null, ru: null, en: null };
  for (const lang of LANGUAGES) {
    result[lang] = optional(env, `${key}_${lang.toUpperCase()}`) ?? base;
  }
  return result;
}

function requiredLocalized(env: Env, key: string): Localized<string> {
  const values = localized(env, key);
  const result: Record<Lang, string> = { hy: "", ru: "", en: "" };
  for (const lang of LANGUAGES) {
    const value = values[lang];
    if (value === null) {
      throw new ConfigError(`Missing required environment variable ${key} (or ${key}_${lang.toUpperCase()})`);
    }
    result[lang] = value;
  }
  return result;
}

function parseDefaultLanguage(env: Env): Lang {
  const raw = optional(env, "DEFAULT_LANGUAGE") ?? "hy";
  if (!isLang(raw)) {
    throw new ConfigError(`DEFAULT_LANGUAGE must be one of ${LANGUAGES.join(", ")}`);
  }
  return raw;
}

function parseSalon(env: Env): SalonConfig {
  const services = localized(env, "BEAUTY_SALON_SERVICES");
  return {
    name: required(env, "BEAUTY_SALON_NAME"),
    contact: requiredLocalized(env, "BEAUTY_SALON_CONTACT"),
    address: requiredLocalized(env, "BEAUTY_SALON_ADDRESS"),
    workingHours: localized(env, "BEAUTY_SALON_WORKING_HOURS"),
    services: {
      hy: parseServices(services.hy),
      ru: parseServices(services.ru),
      en: parseServices(services.en),
    },
    defaultLanguage: parseDefaultLanguage(env),
  };
}

const DB_NAME_PATTERN = /^[A-Za-z0-9_-]{1,38}$/;

export function loadMongoConfig(env: Env = process.env): MongoConfig {
  const uri = required(env, "MONGODB_URI");
  if (!uri.startsWith("mongodb+srv://") && !uri.startsWith("mongodb://")) {
    throw new ConfigError("MONGODB_URI must start with mongodb+srv:// or mongodb://");
  }
  const dbName = optional(env, "MONGODB_DB_NAME") ?? "beauty_salon";
  if (!DB_NAME_PATTERN.test(dbName)) {
    throw new ConfigError("MONGODB_DB_NAME may only contain letters, digits, '_' and '-' (max 38)");
  }
  return { uri, dbName };
}

export function loadWebhookSecret(env: Env = process.env): string {
  const secret = required(env, "TELEGRAM_WEBHOOK_SECRET");
  if (!WEBHOOK_SECRET_PATTERN.test(secret)) {
    throw new ConfigError(
      "TELEGRAM_WEBHOOK_SECRET must be 16-256 characters of A-Z, a-z, 0-9, '_' or '-'",
    );
  }
  return secret;
}

function parseWebhook(env: Env): WebhookConfig {
  const url = required(env, "TELEGRAM_WEBHOOK_URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("TELEGRAM_WEBHOOK_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ConfigError("TELEGRAM_WEBHOOK_URL must use https");
  }
  return {
    url,
    secret: loadWebhookSecret(env),
    path: parsed.pathname === "" ? "/" : parsed.pathname,
    port: positiveInteger(env, "PORT", 8080),
    host: optional(env, "HOST") ?? "0.0.0.0",
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const botToken = required(env, "TELEGRAM_BOT_TOKEN");
  if (!BOT_TOKEN_PATTERN.test(botToken)) {
    throw new ConfigError("TELEGRAM_BOT_TOKEN has an invalid format");
  }

  const modeRaw = optional(env, "BOT_MODE") ?? "polling";
  if (modeRaw !== "polling" && modeRaw !== "webhook") {
    throw new ConfigError('BOT_MODE must be "polling" or "webhook"');
  }

  return {
    botToken,
    mode: modeRaw,
    webhook: modeRaw === "webhook" ? parseWebhook(env) : null,
    mongo: loadMongoConfig(env),
    profilePhotoRefreshHours: positiveInteger(env, "PROFILE_PHOTO_REFRESH_HOURS", 24),
    salon: parseSalon(env),
  };
}
