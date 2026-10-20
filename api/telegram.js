// Vercel serverless function: Telegram webhook endpoint at /api/telegram.
// The TypeScript sources are compiled to dist/ by `npm run build` during deployment.
import { handleTelegramRequest } from "../dist/vercel.js";

export function POST(request) {
  return handleTelegramRequest(request);
}

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
