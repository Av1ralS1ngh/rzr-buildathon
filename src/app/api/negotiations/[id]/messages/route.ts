import { NextRequest, NextResponse } from "next/server";
import {
  listNegotiationMessages,
  postNegotiationMessage,
} from "@/lib/commerce/negotiation-service";
import { negotiationMessageSchema } from "@/lib/commerce/types";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ messages: await listNegotiationMessages(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const input = negotiationMessageSchema.parse(await req.json().catch(() => null));
    const message = await postNegotiationMessage(id, input.actor, input.body);
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
