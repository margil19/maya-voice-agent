// Creates Maya in Retell the first time, and updates her on every later run.
// The Retell IDs are saved in retell.json so re-running never makes duplicates.
//
//   npm run agent:sync                      # the live agent (behind the phone number)
//   TARGET=eval MODEL=gpt-5.4 npm run agent:sync   # a separate test copy for experiments

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Retell from "retell-sdk";
import { AGENT_NAME, MODEL, agentConfig, llmConfig, type Model } from "@/agent/config";

const ID_FILE = "retell.json";
type Ids = { llm_id?: string; agent_id?: string };

const apiKey = process.env.RETELL_API_KEY;
const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
const target = process.env.TARGET === "eval" ? "eval" : "live";
const model = (process.env.MODEL as Model | undefined) ?? MODEL;
if (!apiKey) throw new Error("RETELL_API_KEY is not set (.env.local)");
if (!baseUrl?.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must be an https:// URL Retell can reach");

const retell = new Retell({ apiKey });
const all: Ids & { eval?: Ids } = existsSync(ID_FILE) ? JSON.parse(readFileSync(ID_FILE, "utf8")) : {};
const ids: Ids = target === "eval" ? (all.eval ??= {}) : all;
const name = target === "eval" ? `${AGENT_NAME} (test copy)` : AGENT_NAME;

const llmParams = llmConfig(baseUrl, model);

if (!ids.agent_id || !ids.llm_id) {
  ids.llm_id = (await retell.llm.create(llmParams)).llm_id;
  ids.agent_id = (await retell.agent.create(agentConfig(ids.llm_id, { name, voiceId: process.env.VOICE_ID }))).agent_id;
} else {
  // Only ever edit the newest *draft*. Published versions are what callers hear
  // (see scripts/publish-agent.mts) and must not change underneath them.
  type Version = { version: number; is_published?: boolean };
  const listed = (await retell.agent.listVersions(ids.agent_id)) as unknown as { items?: Version[] } | Version[];
  const versions = (Array.isArray(listed) ? listed : (listed.items ?? [])).sort((a, b) => b.version - a.version);
  let draft = versions.find((v) => !v.is_published)?.version;
  if (draft === undefined) {
    draft = ((await retell.agent.createVersion(ids.agent_id, { base_version: versions[0].version })) as unknown as Version).version;
  }
  const current = (await retell.agent.retrieve(ids.agent_id, { version: draft })) as unknown as {
    response_engine: { llm_id: string; version?: number };
  };
  const llmVersion = current.response_engine.version ?? undefined;
  await retell.llm.update(ids.llm_id, { ...llmParams, ...(llmVersion !== undefined ? { version: llmVersion } : {}) });
  const agentParams = agentConfig(ids.llm_id, { name, voiceId: process.env.VOICE_ID });
  await retell.agent.update(ids.agent_id, {
    ...agentParams,
    response_engine: { ...current.response_engine, type: "retell-llm", llm_id: ids.llm_id },
    version: draft,
  });
  console.log(`edited draft version ${draft} (LLM version ${llmVersion ?? "latest"})`);
}

writeFileSync(ID_FILE, JSON.stringify(all, null, 2) + "\n");
console.log(`[${target}] ${name} · model ${model} · agent ${ids.agent_id} → ${baseUrl}/api/tools`);
