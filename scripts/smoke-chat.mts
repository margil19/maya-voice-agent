// Scripted text conversation with Maya through Retell's playground: the real
// prompt, model and tools, without audio. Usage: npm run agent:smoke

import { readFileSync } from "node:fs";
import Retell from "retell-sdk";

type Message = NonNullable<Parameters<Retell["playground"]["completion"]>[1]["messages"]>[number];

const { agent_id } = JSON.parse(readFileSync("retell.json", "utf8")) as { agent_id: string };
const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });

const turns = [
  "Hi, I got a bill and I just want to pay it.",
  "Aisha Khan.",
  "April 25th, 1999.",
  "My phone number is 646 555 0151.",
  "Yes, text it to me please.",
  "No, that's everything, thanks!",
];

const redact = (s: string) => s.replace(/"verification_token":"[^"]+"/g, '"verification_token":"…"');

function show(m: Message) {
  const x = m as { role: string; content?: string; name?: string; arguments?: string };
  if (x.role === "agent") console.log("MAYA:", x.content);
  else if (x.role === "tool_call_invocation") console.log("  ⚙ call", x.name, redact(x.arguments ?? ""));
  else if (x.role === "tool_call_result") console.log("  ⚙ result", redact(String(x.content)).slice(0, 240));
}

const messages: Message[] = [];
const first = await retell.playground.completion(agent_id, { messages: [] });
for (const m of first.messages ?? []) { show(m); messages.push(m); }

for (const t of turns) {
  console.log("CALLER:", t);
  messages.push({ role: "user", content: t } as Message);
  const r = await retell.playground.completion(agent_id, { messages });
  for (const m of r.messages ?? []) { show(m); messages.push(m); }
}
