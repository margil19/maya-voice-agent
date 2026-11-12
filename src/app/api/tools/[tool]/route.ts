// POST /api/tools/:tool — the endpoint Retell calls for each of Maya's tools.
//
// Retell sends { name, call: { call_id, ... }, args: { ... } }.
// If the function is configured with "args only", the body is just the args.
// Both shapes are accepted.
//
// Every request must carry a valid x-retell-signature: an HMAC of the body made
// with the Retell API key that has the "webhook" badge in the dashboard (which
// may differ from the key used to manage agents). Unsigned requests are only
// allowed in local development.

import { NextResponse } from "next/server";
import { verify } from "retell-sdk";
import { getFailures, recordFailure } from "@/lib/clinic/attempts";
import { isToolName, runTool } from "@/lib/clinic/tools";

async function isAuthorized(rawBody: string, signature: string | null) {
  const signingKey = process.env.RETELL_WEBHOOK_KEY || process.env.RETELL_API_KEY;
  if (signature && signingKey) return verify(rawBody, signingKey, signature);
  // Local development only: allow curl/tests without a signature.
  return process.env.NODE_ENV === "development" && !signature;
}

export async function POST(req: Request, ctx: RouteContext<"/api/tools/[tool]">) {
  const { tool } = await ctx.params;
  if (!isToolName(tool)) {
    return NextResponse.json({ ok: false, error: "unknown_tool" }, { status: 404 });
  }

  const rawBody = await req.text();
  if (!(await isAuthorized(rawBody, req.headers.get("x-retell-signature")))) {
    const sig = req.headers.get("x-retell-signature");
    // Diagnostic only: header shape, never the signature or key.
    console.warn("tool auth failed", {
      tool,
      hasSignature: Boolean(sig),
      signatureShape: sig?.replace(/[0-9a-f]{64}/i, "<hex64>").replace(/\d{10,}/, "<ts>"),
      headerNames: [...req.headers.keys()].filter((h) => h.startsWith("x-")),
      hasWebhookKey: Boolean(process.env.RETELL_WEBHOOK_KEY),
    });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const isRetellEnvelope = typeof body.args === "object" && body.args !== null;
  const args = isRetellEnvelope ? body.args : body;
  const call = body.call as { call_id?: string } | undefined;
  const callId = call?.call_id ?? req.headers.get("x-call-id") ?? undefined;

  // The 3-try verification lock must hold across server instances, so the
  // per-call failure count lives in Redis rather than in this process's memory.
  const priorVerificationFailures = tool === "verify_patient" ? await getFailures(callId) : undefined;
  const result = runTool(tool, args, { callId, now: new Date(), priorVerificationFailures });
  if (tool === "verify_patient" && result.error === "not_verified") await recordFailure(callId);
  // Tool-level failures are still HTTP 200: the agent needs to read the guidance.
  return NextResponse.json(result);
}
