import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { createRfqFromText } from "@/lib/create-rfq";
import { formatInr } from "@/lib/inr";
import {
  TELEGRAM_HELP,
  appPublicUrl,
  extractTelegramText,
  telegramSend,
  telegramWebhookSecret,
} from "@/lib/telegram";
import { handleRoute } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleRoute(() => handleTelegram(req));
}

async function handleTelegram(req: NextRequest) {
  const expected = telegramWebhookSecret();
  if (expected) {
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (header !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const update = await req.json().catch(() => null);
  const { chatId, text, updateId } = extractTelegramText(update);
  if (chatId == null) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (updateId != null) {
    const seen = await db
      .prepare(`SELECT event_id FROM webhook_events WHERE event_id = ?`)
      .get(`tg_${updateId}`);
    if (seen) return NextResponse.json({ ok: true, duplicate: true });
  }

  const trimmed = text ?? "";
  if (!trimmed || trimmed.startsWith("/start") || trimmed.startsWith("/help")) {
    await telegramSend(chatId, TELEGRAM_HELP);
    await rememberUpdate(updateId, "help");
    return NextResponse.json({ ok: true, help: true });
  }

  if (trimmed.length < 10) {
    await telegramSend(
      chatId,
      "That is too short for a job. Send quantity, size in mm, pincode, budget, and delivery — or /help."
    );
    await rememberUpdate(updateId, "too_short");
    return NextResponse.json({ ok: true, tooShort: true });
  }

  const job = await createRfqFromText(trimmed.replace(/^\/job\s+/i, ""), "telegram");
  const desk = `${appPublicUrl()}/rfq/${job.id}`;
  const qty = job.spec.quantity?.toLocaleString("en-IN") ?? "—";
  const trim =
    job.spec.widthMm != null && job.spec.heightMm != null
      ? `${job.spec.widthMm}×${job.spec.heightMm} mm`
      : "—";
  const cap = job.spec.budgetPaise != null ? formatInr(job.spec.budgetPaise) : "—";
  const missing =
    job.missingFields.length > 0
      ? `\nStill need: ${job.missingFields.join(", ")}.`
      : "\nSpec looks complete. Open the desk to verify and take the rupee deposit.";

  await telegramSend(
    chatId,
    [
      `Job ${job.id} opened (${job.engine} parser).`,
      `Qty ${qty} · ${trim} · ${job.spec.productType ?? "label"} · cap ${cap}`,
      missing,
      desk,
    ].join("\n")
  );
  await rememberUpdate(updateId, "rfq_created");
  return NextResponse.json({ ok: true, id: job.id, status: job.status });
}

async function rememberUpdate(updateId: number | undefined, eventType: string) {
  if (updateId == null) return;
  try {
    await db
      .prepare(
        `INSERT INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)`
      )
      .run(`tg_${updateId}`, eventType, Date.now());
  } catch {
    // duplicate event id is fine
  }
}
