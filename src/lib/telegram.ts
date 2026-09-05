export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export function telegramWebhookSecret(): string | undefined {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;
}

export function appPublicUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://rzr-buildathon.vercel.app").replace(
    /\/+$/,
    ""
  );
}

export function extractTelegramText(update: unknown): {
  chatId?: number;
  text?: string;
  updateId?: number;
} {
  if (!update || typeof update !== "object") return {};
  const body = update as {
    update_id?: number;
    message?: {
      chat?: { id?: number };
      text?: string;
      caption?: string;
    };
  };
  const message = body.message;
  const text = message?.text?.trim() || message?.caption?.trim();
  return {
    chatId: message?.chat?.id,
    text,
    updateId: typeof body.update_id === "number" ? body.update_id : undefined,
  };
}

export async function telegramSend(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram send failed (${response.status}) ${detail.slice(0, 180)}`);
  }
}

export async function telegramSetWebhook(url: string, secret: string): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(`setWebhook failed: ${JSON.stringify(body).slice(0, 240)}`);
  }
  return body;
}

export const TELEGRAM_HELP = `SpecLock — send a label job in one message.

Example:
I need 10,000 waterproof mango pickle jar labels 50x30mm, delivery within 10 days to 560001, budget ₹25,000. Labels will be on oil jars in refrigeration.

Include quantity, size (mm), pincode, budget, and when you need it. I will open a job on the deal desk. Deposit still happens in rupees there — not in this chat.`;
