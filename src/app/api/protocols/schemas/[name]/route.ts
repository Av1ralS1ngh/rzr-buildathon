import { NextRequest, NextResponse } from "next/server";

const schemas: Record<string, Record<string, unknown>> = {
  negotiation: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://speclock.example/schemas/negotiation.json",
    title: "SpecLock Negotiation Extension",
    type: "object",
    additionalProperties: false,
    required: ["action", "input"],
    properties: {
      action: {
        enum: [
          "auto_negotiate",
          "counter",
          "list_bundles",
          "select_bundle",
          "accept",
        ],
      },
      input: { type: "object" },
    },
  },
  mandate: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://speclock.example/schemas/mandate.json",
    title: "SpecLock AP2-Compatible Mandate Envelope",
    type: "object",
    required: ["vct", "compactJws", "payloadHash"],
    properties: {
      vct: { type: "string" },
      compactJws: { type: "string" },
      payloadHash: { type: "string" },
    },
  },
  "razorpay-handler": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://speclock.example/schemas/razorpay-handler.json",
    title: "Razorpay INR Redirect Handler",
    type: "object",
    required: ["orderId", "amountPaise", "currency"],
    properties: {
      orderId: { type: "string" },
      amountPaise: { type: "integer", minimum: 0 },
      currency: { const: "INR" },
    },
  },
  "razorpay-instrument": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://speclock.example/schemas/razorpay-instrument.json",
    title: "Razorpay Redirect Instrument",
    type: "object",
    additionalProperties: false,
    required: ["type", "credential"],
    properties: {
      type: { const: "redirect" },
      credential: {
        type: "object",
        additionalProperties: false,
        required: ["type", "token"],
        properties: {
          type: { const: "checkout_session" },
          token: {
            type: "string",
            description:
              "Opaque client correlation token; never a card credential.",
          },
        },
      },
    },
  },
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const schema = schemas[name];
  return schema
    ? NextResponse.json(schema)
    : NextResponse.json({ error: "Schema not found" }, { status: 404 });
}
