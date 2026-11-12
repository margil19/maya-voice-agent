// Replays scripted caller conversations against the test copy of Maya and
// reports: did verification succeed, any narrated/leaked lines, and reply time.
// Caller lines are taken from real call transcripts (including speech-to-text
// errors like "Reese" for "Reyes").
//
//   npx tsx --env-file=.env.local scripts/replay.mts [label]

import { readFileSync } from "node:fs";
import Retell from "retell-sdk";

type Message = NonNullable<Parameters<Retell["playground"]["completion"]>[1]["messages"]>[number];
type M = { role: string; content?: string; name?: string; arguments?: string };

const CONVERSATIONS: Record<string, string[]> = {
  "account path → plan": [
    "Hi. I got a bill. I don't understand.",
    "Daniel Reese.",
    "March fourteenth nineteen eighty four.",
    "H o one zero four two one eight.",
    "Why do I owe eleven hundred fifty dollars? I have insurance.",
    "That's a lot. Can I pay over time?",
    "Six months is fine.",
    "No, that's all. Thanks.",
  ],
  "phone path → pay": [
    "Hi, I need to pay my bill.",
    "Daniel Reese. March fourteenth, nineteen eighty four.",
    "Two one two. Five five five zero one four two.",
    "Can you just text me a link for the whole thing?",
    "No, that's it.",
  ],
  "12 months → hardship rule → 6": [
    "I got a bill I don't understand.",
    "Daniel Reese.",
    "March fourteen nineteen eighty four.",
    "H o one zero four two one eight.",
    "Why do I owe eleven fifty dollars? I have insurance.",
    "I think a payment plan would be easier.",
    "About twelve months.",
    "Six months works for me.",
    "No, that's everything.",
  ],
  "spouse → refuse kindly": [
    "Hi, I'm calling about my husband's bill. Kevin Brooks.",
    "Why can't you just tell me what he owes?",
    "Fine. My number is two one two five five five zero one seven seven.",
    "Okay, thanks.",
  ],
};

// Lines that sound like the model narrating rather than talking to the caller.
const LEAK =
  /\b(the caller|caller's|the user|tool|function call|system (text|message)|I should|I'll ask the|I will ask the|verification_token|agent_guidance|json|nine digits|only \w+ digits|reads as|on file is|sounds alike|I stated|last turn|from here on|I'll use|I'll send|I'll let)\b/i;

const ids = JSON.parse(readFileSync("retell.json", "utf8")) as { eval?: { agent_id?: string } };
const agentId = ids.eval?.agent_id;
if (!agentId) throw new Error("No test copy yet: run TARGET=eval npm run agent:sync");
const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
const label = process.argv[2] ?? "run";
const verbose = process.env.VERBOSE === "1";

// Start every run from a clean slate so earlier runs' plans/links don't leak in.
async function resetBackend() {
  const { createHmac } = await import("node:crypto");
  const token = createHmac("sha256", process.env.VERIFICATION_SECRET ?? "").update("admin:reset").digest("hex");
  const res = await fetch(`${process.env.PUBLIC_BASE_URL}/api/admin/reset`, {
    method: "POST",
    headers: { "x-admin-token": token },
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

const summary: Record<string, unknown>[] = [];
// ONLY="a,b" limits the run to named conversations (keeps paid runs small).
const only = process.env.ONLY?.split(",").map((s) => s.trim());
for (const [name, turns] of Object.entries(CONVERSATIONS)) {
  if (only && !only.some((o) => name.startsWith(o))) continue;
  await resetBackend();
  const messages: Message[] = [];
  const replyMs: number[] = [];
  const leaks: string[] = [];
  const tools: string[] = [];
  let verified = false;

  const step = async () => {
    const t0 = Date.now();
    const r = await retell.playground.completion(agentId, { messages });
    replyMs.push(Date.now() - t0);
    for (const m of r.messages ?? []) {
      messages.push(m);
      const x = m as M;
      if (x.role === "agent" && x.content) {
        if (verbose) console.log("   MAYA:", x.content);
        for (const line of x.content.split(/(?<=[.!?])\s+/)) if (LEAK.test(line)) leaks.push(line);
      }
      if (x.role === "tool_call_invocation" && x.name) {
        tools.push(x.name);
        if (verbose) console.log("   ⚙", x.name, (x.arguments ?? "").replace(/"verification_token":"[^"]+"/g, "…"));
      }
      if (verbose && x.role === "tool_call_result") console.log("   ⚙ →", String(x.content).slice(0, 160));
      if (x.role === "tool_call_result" && /"verified":true/.test(String(x.content))) verified = true;
    }
  };

  await step();
  for (const t of turns) {
    if (verbose) console.log("   CALLER:", t);
    messages.push({ role: "user", content: t } as Message);
    await step();
  }
  const sorted = [...replyMs].sort((a, b) => a - b);
  summary.push({
    label,
    conversation: name,
    verified,
    leaks: leaks.length,
    median_reply_ms: sorted[Math.floor(sorted.length / 2)],
    tools: tools.join(" → "),
  });
  for (const l of leaks) console.log(`   LEAK [${name}]: ${l}`);
}
console.table(summary);
