// Shared, per-call count of failed verification attempts, so the 3-try lock
// holds no matter which server instance handles each request.

import { Redis } from "@upstash/redis";

const TTL_SECONDS = 2 * 60 * 60; // longer than any call

let redis: Redis | null | undefined;
function client() {
  if (redis === undefined) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

const key = (callId: string) => `verify-fail:${callId}`;

/** Returns undefined when shared storage isn't configured (falls back to memory). */
// If Redis is unreachable (outage, rotated credentials before a redeploy), fall
// back to the in-memory count rather than failing the caller's verification.
// The lock still applies per server instance in that case.

export async function getFailures(callId: string | undefined): Promise<number | undefined> {
  const r = client();
  if (!r || !callId) return undefined;
  try {
    return (await r.get<number>(key(callId))) ?? 0;
  } catch (e) {
    console.warn("attempt counter unavailable, using memory", String(e).slice(0, 120));
    return undefined;
  }
}

export async function recordFailure(callId: string | undefined) {
  const r = client();
  if (!r || !callId) return;
  const k = key(callId);
  try {
    await r.incr(k);
    await r.expire(k, TTL_SECONDS);
  } catch (e) {
    console.warn("attempt counter unavailable, not recorded in Redis", String(e).slice(0, 120));
  }
}

export async function clearAll() {
  const r = client();
  if (!r) return;
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(cursor, { match: "verify-fail:*", count: 100 });
    if (keys.length) await r.del(...keys);
    cursor = String(next);
  } while (cursor !== "0");
}
