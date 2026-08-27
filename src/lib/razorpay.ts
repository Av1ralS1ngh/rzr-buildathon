import Razorpay from "razorpay";
import crypto from "crypto";

export function getRazorpay(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const configuredId = keyId && !keyId.includes("xxxxx");
  const configuredSecret = keySecret && !keySecret.includes("xxxxx");
  if (Boolean(configuredId) !== Boolean(configuredSecret)) {
    throw new Error("Both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured");
  }
  if (!configuredId || !configuredSecret) {
    return null;
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const body = `${input.orderId}|${input.paymentId}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return safeEqual(expected, input.signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || secret === "xxxxx") return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqual(expected, signature);
}

export function isRazorpayMockMode(): boolean {
  return getRazorpay() === null;
}

export function assertMockPaymentsAllowed(): void {
  if (
    isRazorpayMockMode() &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_MOCK_PAYMENTS !== "true"
  ) {
    throw new Error(
      "Razorpay is not configured and mock payments are disabled in production"
    );
  }
}

function safeEqual(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
