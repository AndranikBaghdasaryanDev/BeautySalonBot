import { Api } from "grammy";
import { registerCommands } from "./bot/commands.ts";
import { ConfigError, loadWebhookSecret } from "./config.ts";
import { createLogger, describeError } from "./logger.ts";

/**
 * Points Telegram at the deployed webhook (e.g. on Vercel) and registers the
 * command menu. Usage: TELEGRAM_WEBHOOK_URL=https://.../api/telegram npm run webhook:set
 */
async function main(): Promise<void> {
  const logger = createLogger();
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const url = process.env.TELEGRAM_WEBHOOK_URL?.trim();
    if (token === undefined || token === "") throw new ConfigError("Missing TELEGRAM_BOT_TOKEN");
    if (url === undefined || !url.startsWith("https://")) {
      throw new ConfigError("TELEGRAM_WEBHOOK_URL must be set to an https URL");
    }
    const secret = loadWebhookSecret();

    const api = new Api(token);
    await api.setWebhook(url, {
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    await registerCommands(api);

    const info = await api.getWebhookInfo();
    logger.info("Webhook configured", {
      url: info.url ?? null,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message ?? null,
      lastErrorAt: info.last_error_date === undefined ? null : new Date(info.last_error_date * 1000).toISOString(),
    });
  } catch (error) {
    logger.error("Setting the webhook failed", {
      error: error instanceof ConfigError ? error.message : describeError(error),
    });
    process.exitCode = 1;
  }
}

void main();
