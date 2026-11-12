// Locks the live agent's current draft as a published (immutable) version, points
// the phone number at exactly that version, and opens a fresh draft for future work.
// After this, `npm run agent:sync` only changes the draft, never what callers hear.
// Safe to re-run: each step checks whether it's already done.
//
//   npm run agent:publish -- "v1.2: warm tone, sound-alike names"

import { readFileSync } from "node:fs";
import Retell from "retell-sdk";

const title = process.argv[2];
if (!title) throw new Error('Give the version a title: npm run agent:publish -- "v1.2: ..."');

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
const { agent_id } = JSON.parse(readFileSync("retell.json", "utf8")) as { agent_id: string };

type Version = { version: number; is_published?: boolean };
async function versions() {
  const listed = (await retell.agent.listVersions(agent_id)) as unknown as { items?: Version[] } | Version[];
  return (Array.isArray(listed) ? listed : (listed.items ?? [])).sort((a, b) => b.version - a.version);
}

// 1. Publish the newest draft, if there is one.
const draft = (await versions()).find((v) => !v.is_published);
if (draft) {
  try {
    await retell.agent.publish(agent_id, { version: draft.version, version_title: title });
  } catch (e) {
    // The endpoint returns an empty body, which this SDK version fails to parse.
    if (!(e instanceof SyntaxError)) throw e;
  }
  console.log(`Published version ${draft.version}: ${title}`);
}

// 2. Pin phone numbers routed to this agent to the newest published version.
const published = (await versions()).find((v) => v.is_published);
if (!published) throw new Error("Nothing is published.");
const numbers = (await retell.phoneNumber.list({})) as unknown as {
  items?: { phone_number: string; phone_number_pretty?: string; inbound_agents?: { agent_id: string }[] }[];
};
for (const n of numbers.items ?? []) {
  if (!n.inbound_agents?.some((a) => a.agent_id === agent_id)) continue;
  await retell.phoneNumber.update(n.phone_number, {
    inbound_agents: [{ agent_id, agent_version: published.version, weight: 1 }],
  });
  console.log(`Pinned ${n.phone_number_pretty ?? n.phone_number} → version ${published.version}`);
}

// 3. Make sure there's a draft to keep working on.
if (!(await versions()).some((v) => !v.is_published)) {
  const next = (await retell.agent.createVersion(agent_id, { base_version: published.version })) as unknown as Version;
  console.log(`Opened draft version ${next.version} for further changes`);
}
