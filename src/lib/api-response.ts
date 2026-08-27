import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { validationMessage } from "./validation";

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: validationMessage(error) },
      { status: 400 }
    );
  }
  const message = error instanceof Error ? error.message : "Request failed";
  const status = /bearer token|unauthorized|authentication/i.test(message)
    ? 401
    : /required|invalid|unsupported/i.test(message)
    ? 400
    : /not found|unknown product|unavailable/i.test(message)
    ? 404
    : /expired/i.test(message)
      ? 410
      : /already|concurrent|active|reference|outside|exceeds|reached/i.test(message)
        ? 409
        : 422;
  return NextResponse.json({ error: message }, { status });
}
