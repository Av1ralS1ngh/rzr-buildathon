import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@/lib/commitment";
import {
  acceptSellerOffer,
  counterNegotiation,
  createNegotiation,
  getNegotiation,
  runAutonomousNegotiation,
} from "@/lib/commerce/negotiation-service";
import {
  generateBundleOptions,
  selectBundleOption,
} from "@/lib/commerce/bundle-optimizer";
import {
  acceptOfferSchema,
  counterOfferSchema,
  createNegotiationSchema,
} from "@/lib/commerce/types";
import { A2A_VERSION } from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    message: z
      .object({
        messageId: z.string().min(1),
        contextId: z.string().optional(),
        taskId: z.string().optional(),
        role: z.literal("ROLE_USER"),
        parts: z
          .array(
            z
              .object({
                data: z
                  .object({
                    action: z.enum([
                      "negotiation.create",
                      "negotiation.get",
                      "negotiation.counter",
                      "negotiation.auto",
                      "negotiation.accept",
                      "bundle.list",
                      "bundle.select",
                    ]),
                    payload: z.record(z.string(), z.unknown()).default({}),
                  })
                  .strict(),
                mediaType: z.string().optional(),
              })
              .strict()
          )
          .length(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    configuration: z
      .object({
        acceptedOutputModes: z.array(z.string()).optional(),
        returnImmediately: z.boolean().optional(),
        historyLength: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const version = req.headers.get("a2a-version");
    if (version && version !== A2A_VERSION) {
      return NextResponse.json(
        { error: "VersionNotSupportedError", supportedVersions: [A2A_VERSION] },
        { status: 400 }
      );
    }
    const request = requestSchema.parse(await req.json());
    const command = request.message.parts[0].data;
    const contextId =
      request.message.contextId ??
      (typeof command.payload.sessionId === "string"
        ? command.payload.sessionId
        : undefined);
    const result = executeAction(
      command.action,
      command.payload,
      contextId,
      request.message.messageId
    );
    const resolvedContext =
      contextId ??
      (result && typeof result === "object" && "id" in result
        ? String(result.id)
        : newId("context"));
    return NextResponse.json({
      message: {
        messageId: newId("msg"),
        contextId: resolvedContext,
        role: "ROLE_AGENT",
        parts: [
          {
            data: result,
            mediaType: "application/json",
          },
        ],
        metadata: {
          protocol: "A2A",
          protocolVersion: A2A_VERSION,
          inReplyTo: request.message.messageId,
        },
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function executeAction(
  action: z.infer<typeof requestSchema>["message"]["parts"][0]["data"]["action"],
  payload: Record<string, unknown>,
  contextId: string | undefined,
  messageId: string
) {
  if (action === "negotiation.create") {
    return createNegotiation(
      createNegotiationSchema.parse({
        ...payload,
        idempotencyKey: `a2a:${messageId}`,
      })
    );
  }
  const sessionId =
    contextId ??
    (typeof payload.sessionId === "string" ? payload.sessionId : undefined);
  if (!sessionId) throw new Error("contextId or payload.sessionId is required");
  if (action === "negotiation.get") return getNegotiation(sessionId);
  if (action === "negotiation.auto") return runAutonomousNegotiation(sessionId);
  if (action === "bundle.list") return { bundles: generateBundleOptions(sessionId) };
  if (action === "bundle.select") {
    const bundleId = z.string().min(1).parse(payload.bundleId);
    return { offer: selectBundleOption(sessionId, bundleId) };
  }
  if (action === "negotiation.counter") {
    return counterNegotiation(
      sessionId,
      counterOfferSchema.parse({
        ...payload,
        idempotencyKey: `a2a:${messageId}`,
      })
    );
  }
  const accepted = acceptOfferSchema.parse({
    ...payload,
    idempotencyKey: `a2a:${messageId}`,
  });
  return acceptSellerOffer(sessionId, accepted.offerId, accepted.idempotencyKey);
}
