export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logger. Callers must never pass bot tokens or customer
 * personal data (names, usernames, IDs) in fields.
 */
export function createLogger(minLevel: LogLevel = "info"): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
    if (level === "error" || level === "warn") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };
  return {
    debug: (message, fields) => { write("debug", message, fields); },
    info: (message, fields) => { write("info", message, fields); },
    warn: (message, fields) => { write("warn", message, fields); },
    error: (message, fields) => { write("error", message, fields); },
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function parseLogLevel(raw: string | undefined): LogLevel {
  return raw === "debug" || raw === "warn" || raw === "error" ? raw : "info";
}

/** Returns a safe, PII-free description of an error for logging. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown error";
}
