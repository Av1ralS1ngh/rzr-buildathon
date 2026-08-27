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
import { counterOfferSchema } from "@/lib/commerce/types";
import {
  ACP_VERSION,
  toAcpCheckout,
} from "@/lib/commerce/protocol-adapters";
import { apiError } from "@/lib/api-response";
import { isAcpAuthorized } from "@/lib/commerce/protocol-auth";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    metadata: z
      .object({
        speclock_action: z.enum([
          "auto_negotiate",
          "counter",
          "list_bundles",
          "select_bundle",
          "accept",
        ]),
        speclock_input: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
  })
  .passthrough();

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    validateVersion(req);
    requireAuthorization(req);
    const { id } = await ctx.params;
    return acpResponse(await toAcpCheckout(id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    validateVersion(req);
    requireAuthorization(req);
    const { id } = await ctx.params;
    const body = updateSchema.parse(await req.json());
    const action = body.metadata.speclock_action;
    const input = body.metadata.speclock_input;
    let result: unknown;
    if (action === "auto_negotiate") {
      result = await runAutonomousNegotiation(id);
    } else if (action === "list_bundles") {
      result = { bundles: await generateBundleOptions(id) };
    } else if (action === "select_bundle") {
      result = {
        offer: await selectBundleOption(id, z.string().parse(input.bundleId)),
      };
    } else if (action === "accept") {
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
    const checkout = await toAcpCheckout(id);
    return acpResponse({
      ...checkout,
      metadata: {
        ...checkout.metadata,
        speclock_operation_result: result,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function validateVersion(req: NextRequest) {
  const version = req.headers.get("api-version");
  if (version !== ACP_VERSION) {
    throw new Error(`API-Version must be ${ACP_VERSION}`);
  }
}

function requireAuthorization(req: NextRequest) {
  if (!isAcpAuthorized(req)) throw new Error("Invalid bearer token");
}

function acpResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: { "API-Version": ACP_VERSION },
  });
}
