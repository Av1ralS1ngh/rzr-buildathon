import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptSellerOffer,
  counterNegotiation,
  getNegotiation,
  runAutonomousNegotiation,
} from "@/lib/commerce/negotiation-service";
import {
  generateBundleOptions,
  selectBundleOption,
} from "@/lib/commerce/bundle-optimizer";
import {
  counterOfferSchema,
} from "@/lib/commerce/types";
import {
  toUcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    extensions: z
      .object({
        "in.speclock.negotiation": z
          .object({
            action: z.enum([
              "auto_negotiate",
              "counter",
              "list_bundles",
              "select_bundle",
              "accept",
            ]),
            input: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      })
      .passthrough(),
  })
  .passthrough();

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    requireRequestId(req);
    const { id } = await ctx.params;
    return ucpResponse(await toUcpCheckout(id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    requireRequestId(req);
    const { id } = await ctx.params;
    const body = updateSchema.parse(await req.json());
    const command = body.extensions["in.speclock.negotiation"];
    const input = command.input;
    let result: unknown;
    if (command.action === "auto_negotiate") {
      result = await runAutonomousNegotiation(id);
    } else if (command.action === "list_bundles") {
      result = { bundles: await generateBundleOptions(id) };
    } else if (command.action === "select_bundle") {
      result = {
        offer: await selectBundleOption(id, z.string().parse(input.bundleId)),
      };
    } else if (command.action === "accept") {
      result = await acceptSellerOffer(id, z.string().parse(input.offerId));
    } else {
      const session = await getNegotiation(id);
      const active = [...session.offers]
        .reverse()
        .find((offer) => offer.actor === "seller" && offer.status === "active");
      if (!active) throw new Error("No active seller offer found");
      result = await counterNegotiation(
        id,
        counterOfferSchema.parse({
          ...input,
          parentOfferId: input.parentOfferId ?? active.id,
        })
      );
    }
    const checkout = await toUcpCheckout(id);
    return ucpResponse({
      ...checkout,
      operation_result: result,
    });
  } catch (error) {
    return apiError(error);
  }
}

function ucpResponse(body: unknown) {
  return NextResponse.json(body);
}

function requireRequestId(req: NextRequest) {
  if (!req.headers.get("ucp-agent")) {
    throw new Error("UCP-Agent header is required");
  }
  if (!req.headers.get("request-id")) {
    throw new Error("Request-Id header is required");
  }
}
