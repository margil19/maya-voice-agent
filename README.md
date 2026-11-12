# Maya: AI Billing Agent for Harbor Orthopedics

A voice agent that answers inbound patient billing calls for a fictional orthopedic clinic: she explains bills, sends secure payment links, sets up payment plans, fixes insurance problems, and hands off to a person when she should.

Built as a work sample for an AI Product Manager application. The emphasis is less on the bot and more on running it like a production deployment: guardrails in code, versioned releases, and improvements driven by diagnosing real calls.

**Try it:** call **(401) 399-6716** · reviewer guide with test callers at **https://maya-voice-agent-demo.vercel.app**

All patients, claims and phone numbers are synthetic.

## How it works

```
Caller ──voice──▶ Voice AI platform (speech recognition, GPT-4.1, "Grace" voice)
                     │  signed HTTPS tool calls
                     ▼
               Next.js on Vercel: /api/tools/<tool>
               patients · claims · billing policy · audit log
                     │
                     ▼
               Upstash Redis (per-call verification attempt lock)
```

- **Guardrails are enforced in the backend, not just the prompt.** Account data needs a signed, call-bound token from identity verification, and three failed attempts lock the call. Payment plans are validated against clinic policy, and every dollar amount Maya says comes from the backend.
- **The agent is configuration as code.** The prompt, model, voice and tools live in `src/agent/` and are pushed to the voice platform by script. Callers only reach a **published, pinned** version; changes go to a draft and a separate test copy first.
- **Tool definitions sent to the voice platform are generated** from the same schemas the backend validates against, so the two can't drift apart.

## Docs

1. [Use case](docs/01-use-case.md): the problem, scope, rules and scorecard
2. [Mock clinic backend](docs/02-mock-backend.md): patients, tools and design decisions
3. [Maya on the voice platform](docs/03-maya-v1.md): agent setup, security, and what real calls taught us (v1 → v1.6): misheard names, a model switch to stop spoken reasoning, exact plan amounts, and a verification lock that had to move to shared storage

Full reference (configuration, IDs, version history, every fix, runbook): [docs/PROJECT.md](docs/PROJECT.md)

## Project layout

| Path | What it is |
|---|---|
| `src/lib/clinic/` | Synthetic data, verification, billing policy, the 8 tools, the attempt counter |
| `src/app/api/tools/[tool]/` | The endpoint the voice platform calls (signature-checked) |
| `src/agent/` | Maya's prompt (with a version log) and the voice platform configuration |
| `src/app/page.tsx` | The reviewer one-pager |
| `scripts/` | Sync, publish, smoke-test and replay scripts for the voice agent |
| `tests/` | Data consistency, every spec scenario, and regression tests from real calls |

## Running it

```bash
npm install
npm run dev          # one-pager at http://localhost:3000, tools at /api/tools
npm test
npm run typecheck
```

`.env.local` needs:

| Variable | Purpose |
|---|---|
| `RETELL_API_KEY` | Manage the agent in the voice platform |
| `RETELL_WEBHOOK_KEY` | The platform key with the "webhook" badge; verifies tool-call signatures |
| `VERIFICATION_SECRET` | Signs caller-verification tokens |
| `PUBLIC_BASE_URL` | Where the voice platform reaches the tool endpoints |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Optional. Upstash Redis for the attempt lock; falls back to memory if unset |

Locally, unsigned tool requests are allowed so you can `curl` them; in production every request must be signed by the voice platform.

## Working on the agent

```bash
npm run agent:sync                                  # update the live agent's draft from src/agent/
TARGET=eval npm run agent:sync                      # update the separate test copy instead
npm run agent:smoke                                 # one scripted conversation through the voice platform
ONLY="phone path" npx tsx --env-file=.env.local scripts/replay.mts   # replay real-call conversations on the test copy
npm run agent:publish -- "vX: what changed"         # publish the draft and pin the phone number to it
```

Smoke tests and replays use paid model calls on the voice platform account. Use `ONLY=` to run just the conversations you need.
