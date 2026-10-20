import { createServer, type Server } from "node:http";
import { webhookCallback, type Bot } from "grammy";
import { describeError, type Logger } from "./logger.ts";

/**
 * HTTP server for webhook mode. Only POST requests to `path` that carry the
 * correct X-Telegram-Bot-Api-Secret-Token header reach the bot; grammY answers
 * 401 otherwise. No customer data is exposed over HTTP.
 */
export function createWebhookServer(bot: Bot, path: string, secret: string, logger: Logger): Server {
  const handleUpdate = webhookCallback(bot, "http", { secretToken: secret, onTimeout: "return" });

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname !== path) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    handleUpdate(req, res).catch((error: unknown) => {
      logger.error("Webhook handling failed", { error: describeError(error) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
