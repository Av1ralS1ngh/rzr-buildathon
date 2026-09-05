import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import db from "@/lib/db";
import { POST as telegramWebhook } from "@/app/api/telegram/webhook/route";
import { extractTelegramText } from "@/lib/telegram";

beforeEach(async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  await db.exec(`
    DELETE FROM webhook_events;
    DELETE FROM audit_events;
    DELETE FROM rfqs;
  `);
});

describe("Telegram inbox", () => {
  it("pulls caption or text out of an update", () => {
    expect(
      extractTelegramText({
        update_id: 9,
        message: { chat: { id: 42 }, caption: "Need 2,000 serum labels 40x20mm" },
      })
    ).toMatchObject({ chatId: 42, text: "Need 2,000 serum labels 40x20mm", updateId: 9 });
  });

  it("opens the same RFQ as the desk from a WhatsApp-style sentence", async () => {
    const response = await telegramWebhook(
      new NextRequest("http://localhost:43123/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update_id: 101,
          message: {
            chat: { id: 77 },
            text: "Need 10,000 waterproof pickle labels 50x30mm within 10 days to 560001, budget ₹25,000, oil and refrigeration",
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toMatch(/^rfq_/);
    const row = await db.prepare(`SELECT spec_json FROM rfqs WHERE id = ?`).get<{ spec_json: string }>(body.id);
    const spec = JSON.parse(row?.spec_json ?? "{}");
    expect(spec.quantity).toBe(10_000);
    expect(spec.widthMm).toBe(50);
  });

  it("rejects a forged webhook when a secret is configured", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "desk-secret";
    const response = await telegramWebhook(
      new NextRequest("http://localhost:43123/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update_id: 2,
          message: { chat: { id: 1 }, text: "Need 10,000 pickle labels 50x30mm to 560001 budget ₹25000" },
        }),
      })
    );
    expect(response.status).toBe(401);
  });
});
