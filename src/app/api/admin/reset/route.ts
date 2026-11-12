// POST /api/admin/reset — clears everything Maya has done (plans, links,
// tickets, holds, logs) so test runs start from the same state.
// Requires x-admin-token = HMAC-SHA256(VERIFICATION_SECRET, "admin:reset").

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { clearAll } from "@/lib/clinic/attempts";
import { resetStore } from "@/lib/clinic/store";

export async function POST(req: Request) {
  const secret = process.env.VERIFICATION_SECRET;
  const given = Buffer.from(req.headers.get("x-admin-token") ?? "");
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const expected = Buffer.from(createHmac("sha256", secret).update("admin:reset").digest("hex"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  resetStore();
  await clearAll();
  return NextResponse.json({ ok: true, reset: true });
}
