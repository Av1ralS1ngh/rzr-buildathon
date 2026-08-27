import type { NextRequest } from "next/server";

export function isAcpAuthorized(req: NextRequest): boolean {
  const expected = process.env.ACP_API_KEY;
  return !expected || req.headers.get("authorization") === `Bearer ${expected}`;
}
