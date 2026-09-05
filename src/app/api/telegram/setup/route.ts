import { NextRequest, NextResponse } from "next/server";
import { appPublicUrl, telegramSetWebhook, telegramWebhookSecret } from "@/lib/telegram";
import { handleRoute } from "@/lib/api-response";

export const runtime = "nodejs";

/** Registers the production webhook with Telegram. Call once after TELEGRAM_BOT_TOKEN is set. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = process.env.SPELOCK_INTERNAL_SECRET;
    if (!secret || req.headers.get("x-speclock-internal") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const webhookSecret = telegramWebhookSecret();
    if (!webhookSecret) {
      return NextResponse.json(
        { error: "TELEGRAM_WEBHOOK_SECRET is not set" },
        { status: 500 }
      );
    }
    const url = `${appPublicUrl()}/api/telegram/webhook`;
    const result = await telegramSetWebhook(url, webhookSecret);
    return NextResponse.json({ ok: true, url, result });
  });
}
