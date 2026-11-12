# Maya: Project Details

The complete reference for this project: what was built, how it's configured, every decision and fix, and how to operate it. For the narrative version, see the technical paper; for the step-by-step design docs, see `docs/01`–`03`.

As of 2026-11-11.

---

## 1. At a glance

| | |
|---|---|
| **What** | An inbound voice agent ("Maya") that handles patient billing calls for a fictional orthopedic group, Harbor Orthopedics |
| **Why** | A work sample for an AI Product Manager application at a healthcare voice-AI company: show how to build *and run* an agent in production |
| **Call it** | **(401) 399-6716** (US number) |
| **Reviewer page** | https://maya-voice-agent-demo.vercel.app |
| **Code** | https://github.com/margil19/maya-voice-agent (public) |
| **Status** | Steps 1–3 of 6 done (spec, backend, live agent); steps 4–6 (simulation scoring, ops dashboard, v2 memo) not started |
| **Data** | 100% synthetic: patients, claims, phone numbers (555-01xx range) |

---

## 2. The use case

**Setting:** Harbor Orthopedics, 4 locations in New York. Agent "Maya", available 24/7.

**Six caller intents and what "resolved" means**

| # | Intent | Resolved means |
|---|---|---|
| 1 | Why do I owe this? | Statement explained line by line: billed → plan rate → insurance paid → patient share (deductible / coinsurance / copay) |
| 2 | I want to pay | Secure payment link sent by text or email to the contact on file; never card numbers by voice |
| 3 | Can I pay over time? | Payment plan created within policy |
| 4 | Insurance should have covered this | Fixable denial (e.g. coordination of benefits) corrected and resubmitted, balance put on hold; otherwise a ticket |
| 5 | I can't afford this | Hardship plan requested for human approval |
| 6 | Anything else | Routed to a person or a callback |

**Scorecard (targets set before building; not yet measured at scale)**

| Metric | Target |
|---|---|
| Resolved without a human | ≥ 75% (vs 60% claimed for the reference company's billing agent) |
| Dollar amounts accurate | 100% |
| Escalations with a full handoff note | 100% |
| Account details before verification | 0 |
| Card numbers taken on the call | 0 |
| Promised write-offs or outcomes | 0 |

---

## 3. Architecture

```
Caller ──voice──▶ Voice AI platform (speech recognition, GPT-4.1, "Grace" voice, call-center ambience)
                     │  signed HTTPS tool calls (HMAC-signed)
                     ▼
               Next.js on Vercel: POST /api/tools/<tool>
               synthetic patients · claims · billing policy · audit log
                     │
                     ▼
               Upstash Redis: per-call verification attempt lock

Git repo (src/agent) ── npm run agent:sync / agent:publish ──▶ Voice AI platform
```

### Stack

| Layer | Technology | Version |
|---|---|---|
| Voice platform | Hosted voice AI platform (built-in LLM engine) | Vendor SDK |
| Language model | GPT-4.1 (via the voice platform), temperature 0.2 | — |
| Voice | `minimax-Grace`, call-center ambience at 0.8 | — |
| App framework | Next.js (App Router) + React | 16.4.6 / 19.3.0 |
| Validation | zod (also generates the tool JSON Schemas) | 4.6.7 |
| Hosting | Vercel (Fluid Compute) | — |
| Shared state | Upstash Redis via Vercel Marketplace (`upstash-kv-aquamarine-park`, free plan) | `@upstash/redis` 1.41 |
| Analytics | Vercel Web Analytics | `@vercel/analytics` 2.0.1 |
| Tests | Vitest | 5.1 |
| Scripts | tsx | 4.23 |
| Runtime | Node.js | 24 |
| Styling | Tailwind CSS | 4.3.3 |

### Code layout

| Path | Contents |
|---|---|
| `src/lib/clinic/types.ts` | Domain model (patients, statements, claims) |
| `src/lib/clinic/data.ts` | 8 synthetic patients, statements, claims |
| `src/lib/clinic/verification.ts` | Identity matching (Soundex, spoken numbers), signed tokens |
| `src/lib/clinic/policy.ts` | Plan rules, installment math, payment options, business hours, explanations |
| `src/lib/clinic/tools.ts` | The 8 tools, `runTool`, tool JSON Schemas |
| `src/lib/clinic/store.ts` | In-memory store (plans, links, tickets, holds, tool-call log) |
| `src/lib/clinic/attempts.ts` | Redis-backed failed-verification counter with memory fallback |
| `src/app/api/tools/[tool]/route.ts` | Tool endpoint: signature check, Redis counter, dispatch |
| `src/app/api/tools/route.ts` | `GET` list of tools and schemas |
| `src/app/api/admin/reset/route.ts` | Clears demo state (HMAC-protected) |
| `src/agent/prompt.ts` | System prompt + version log |
| `src/agent/config.ts` | Model, voice, speech settings, tools wiring, post-call analysis |
| `src/app/page.tsx`, `scenarios.ts` | Reviewer one-pager |
| `scripts/sync-agent.mts` | Create/update the agent draft (live or test copy) |
| `scripts/publish-agent.mts` | Publish draft, pin phone number, open next draft |
| `scripts/smoke-chat.mts` | One scripted conversation via the voice platform playground |
| `scripts/replay.mts` | Real-call replays on the test copy: verification, leaks, reply time |
| `tests/` | 60 tests: data integrity, scenarios, real-call regressions |

---

## 4. The clinic backend

### Tools

| Tool | Needs verification | Does |
|---|---|---|
| `verify_patient` | — | Matches name + DOB + account number or phone; issues a token |
| `get_statement` | Yes | Line items with plain-language explanations, totals, holds, plan, exact `payment_options` |
| `get_claim_status` | Yes | Claim status, denial code/reason, whether the agent can fix it, next step |
| `send_payment_link` | Yes | Secure link to masked contact on file; amount ≤ amount due |
| `create_payment_plan` | Yes | Installments or deferral within policy; replaces a pending plan |
| `update_insurance` | Yes | New coverage for a fixable denial → resubmission + 45-day hold |
| `create_ticket` | Optional | Handoff to billing team; disputes/out-of-network reviews add a 30-day hold |
| `transfer_to_human` | Optional | Simulated warm transfer (Mon–Fri 8–18 ET) or callback ticket |

Every response includes `agent_guidance` (what to say next). Failures return `{ok:false, error, agent_guidance}` with HTTP 200 so the agent can read them; only auth failures return 401.

### Verification rules

- **Required:** first name, last name, DOB (`YYYY-MM-DD`), and account number **or** phone on file.
- **Must match exactly:** DOB and the second factor.
  - Account: compared on its **six digits** ("HO", "H zero", "H h o", "eight zero" prefixes all tolerated).
  - Phone: last 10 digits; spoken words ("two one two", "oh", "double/triple five") are normalized.
- **May match by sound (Soundex):** first and last name ("Reese" ↔ Reyes, "Ayesha" ↔ Aisha), only when DOB and second factor match.
- **Token:** HMAC-SHA256 with `VERIFICATION_SECRET`, bound to the call ID, expires in 1 hour.
- **Lock:** 3 failed attempts per call → `verification_locked`, even with correct details. Counter in Redis (`verify-fail:<call_id>`, 2 h TTL), falls back to memory if Redis fails.
- **Incomplete input** (e.g. phone with < 10 digits) → `incomplete_input`, does **not** use an attempt.
- **Never** reveals which detail was wrong. Match type is logged for audit only (`_audit`), never shown to the model.

### Billing policy

| Rule | Value |
|---|---|
| Minimum balance for installments | $200 |
| Automatic plans | 2–6 months |
| Hardship plans | 7–12 months, require caller's stated `hardship_reason`, status `pending_approval` + approval ticket |
| Minimum monthly payment | $50 |
| Balances under $200 | Pay in full, or one deferred date ≤ 30 days |
| Installment math | Equal payments rounded down to the cent; last payment absorbs the remainder |
| Standard options quoted | Pay in full, 3 months, 6 months (when ≥ $50/month) |
| Insurance resubmission hold | 45 days |
| Dispute / out-of-network review hold | 30 days |

### Test patients

| Scenario | Patient | DOB | Account | Phone | Balance | Situation |
|---|---|---|---|---|---|---|
| A | Daniel Reyes | 1984-03-14 | HO-104218 | (212) 555-0142 | $1,150 | MRI to deductible ($2,000/yr, $850 met) |
| B | Priya Shah | 1991-07-02 | HO-104377 | (718) 555-0187 | $240 | 8 PT visits × $30 (20% coinsurance) |
| C | Marcus Bell | 1978-11-30 | HO-103952 | (646) 555-0119 | $685 | Denied CO-22; new Aetna plan from 2026-07-01 |
| D | Linda Okafor | 1969-05-21 | HO-104011 | (917) 555-0163 | $3,150 | Out-of-network surgery → human review |
| E | James Whitfield | 1956-02-09 | HO-103785 | (347) 555-0128 | $0 | Paid 2026-11-03 after statement |
| F | Rosa Delgado | 1988-12-12 | HO-103866 | (929) 555-0174 | $2,400 | Hardship (lost job) |
| G/H | Kevin Brooks | 1975-09-03 | HO-104150 | (212) 555-0196 | $560 | Angry caller / spouse fails verification |
| I | Aisha Khan | 1999-04-25 | HO-104402 | (646) 555-0151 | $85 | Two copays, pay now |

---

## 5. The agent (voice platform)

### Resources

| Resource | ID |
|---|---|
| Live agent "Maya – Harbor Orthopedics Billing" | `agent_8f06a88c96943eca13b84329e5` |
| Live LLM | `llm_7a58f32d1a7f4e72352214fc0799` |
| Test copy agent | `agent_fcf6b3139a032736e6de614574` |
| Test copy LLM | `llm_091d6f825f1ee33d48960beec18b` |
| Phone number | +1 401 399 6716, pinned to **version 8** |

(IDs are not secrets; they're also in `retell.json`.)

### Configuration (in `src/agent/config.ts`)

| Setting | Value |
|---|---|
| Model | `gpt-4.1`, temperature 0.2 |
| Voice | `minimax-Grace`, expressive mode on |
| Ambience | `call-center`, volume 0.8 |
| Responsiveness | 1.0 |
| Interruption sensitivity | 0.75 |
| Backchannel | On |
| Handbook | Filler words **off**, conversational personality **off**; AI disclosure, echo verification, high empathy, NATO alphabet, scope boundaries, smart matching, speech normalization on |
| Speech recognition | `en-US`, medical vocabulary, boosted payer/billing terms |
| Limits | 15 min max call; end after 30 s silence |
| Tool calls | 10 s timeout; a fixed spoken line during each tool (e.g. "Thanks, one moment while I find your account.") |
| Post-call analysis | `primary_intent`, `resolved_without_human`, `escalated`, `dollars_committed`, `caller_sentiment_end`, `compliance_concern` |

### Agent version history

| Version | Status | Contents |
|---|---|---|
| 0 | Published | v1.2: warm prompt, Kate voice, sound-alike names, Sonnet 5.5 |
| 1 | Published | v1.4: GPT-4.1, hardship needs stated reason |
| 2 | Published | v1.5: exact plan amounts, six-digit account match |
| 3–6 | Published | Dashboard tuning: call-center ambience, Grace voice, faster turn-taking |
| 7 | Published | v1.6: dashboard tuning synced into code |
| **8** | **Published, pinned** | Filler words and personality off, interruption 0.75, responsiveness 1 |
| 9 | Draft | Identical to 8 |

### Prompt versions (`src/agent/prompt.ts`)

| Version | Change | Trigger |
|---|---|---|
| v1 | Initial prompt: tone, 7 rules, tool usage, common calls | — |
| v1.1 | "Everything you output is spoken" | First smoke test narrated reasoning |
| v1.2 | Warm tone section, rule placement, no digit counting | First real calls: harsh tone, narration, miscount |
| v1.3 | Exact figures only; never comment on earlier ones | Narrated self-correction |
| v1.4 | Model → GPT-4.1; hardship needs reason | Sonnet narration persisted |
| v1.5 | Quote `payment_options` only; no unsolicited hardship; ask verification details one at a time | Rounded amounts, unprompted 12-month offer |

---

## 6. Problems found and how they were fixed

| # | Symptom | Root cause | Fix | Layer |
|---|---|---|---|---|
| 1 | All tool calls 401 | The voice platform signs with the **webhook-badged** key | `RETELL_WEBHOOK_KEY` | Backend |
| 2 | Reasoning spoken aloud | Reasoning model narrating around tool calls | Prompt rules (partial) → GPT-4.1 (resolved) | Prompt, model |
| 3 | "Reese" couldn't verify as Reyes | Exact last-name match vs speech-to-text spelling | Soundex last names when strong factors match | Backend |
| 4 | "Only nine digits" loop | Model miscounted a 10-digit number | Backend checks completeness; `incomplete_input` doesn't cost an attempt | Backend, prompt |
| 5 | Harsh tone | Curt wording, voice, 2.3 s replies | Warm prompt, new voice, faster model | Prompt, voice, model |
| 6 | Model sent "H O one zero four..." as words | Field description said "send what they said" | Backend normalizes spoken numbers | Backend |
| 7 | "The tool says it sounds alike" | Match type exposed to the model | Audit-only `_audit` field | Backend |
| 8 | "I stated a monthly figure last turn..." | Model rounded, then self-corrected aloud | Exact-figure rule; backend amounts | Prompt, backend |
| 9 | Hardship flagged without a reason | Boolean flag set by model judgment | `hardship_reason` string required | Backend |
| 10 | 12 months → 6 months blocked | Pending plan blocked a new one | Pending plan replaced, approval ticket withdrawn | Backend |
| 11 | "Eight zero" for "H O" | Prefix-sensitive account match | Compare six digits only | Backend |
| 12 | "About one ninety-two" | Model did its own division | `payment_options` with exact amounts | Backend, prompt |
| 13 | 12-month plan offered unprompted | Hardship option visible to all | Not listed; only on stated hardship | Prompt, backend |
| 14 | "Ayesha" failed 3 times | Exact first-name match | Soundex first names | Backend |
| 15 | 4th attempt got through | Counter in one instance's memory | Redis counter + memory fallback | Backend, infra |
| 16 | Callers heard old voice | Dashboard publish doesn't move the pin | Settings into code; `agent:publish` re-pins | Operations |
| 17 | Choppy speech, "um... uh..." | Filler words, personality, high interruption sensitivity | Off / off / 0.75 | Voice settings |

---

## 7. Model comparison

Replays of real-call conversations via the voice platform playground (reply times are round trips, not phone latency):

| Model | Verified | Spoken reasoning | Median reply | Notes |
|---|---|---|---|---|
| **GPT-4.1** (chosen) | ✅ | None | ~1.2 s | Flagged hardship once on its own → fixed in code |
| Claude Sonnet 5.5 | ✅ | ~1 in 2 conversations | ~1.7 s | Best explanations |
| Claude Haiku 5.5 | ❌ phone path | 1 line | ~1.1 s | Stuck re-asking |
| GPT-5.4 mini | ❌ account path | None | 1.5–2.2 s | Verification loop |
| Gemini 3.5 Flash | ✅ | None | ~1.5 s | Skipped the explanation |

Caveat: the first comparison predates spoken-number parsing in the backend.

---

## 8. Decisions considered

| Decision | Chosen | Alternatives | Reason |
|---|---|---|---|
| Use case | Patient billing | Payer benefits verification; scheduling | Revenue-linked, demoable by phone, less overdone |
| Rule enforcement | Backend | Prompt only | Prompts drift; code refuses |
| Agent setup | Config as code | Dashboard | Versioned, reviewable, reproducible |
| Releases | Published + pinned | Live edits | No half-tested changes reach callers |
| Narration fix | Model switch | Custom-LLM server with output filter | Community-standard fix, no new infra; filter kept as fallback |
| Hosting | Vercel | ngrok tunnel | Permanent URL |
| Shared state | Upstash Redis | Memory; Postgres | Counter + TTL = key-value job |
| Payments | Link to contact on file | Voice card capture | Keeps card data out of voice |
| Reviewer page | Home page of the backend site | Separate artifact | One link; data pulled from the same source |

---

## 9. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `RETELL_API_KEY` | Local, Vercel (sensitive) | Manage agents |
| `RETELL_WEBHOOK_KEY` | Local, Vercel (sensitive) | Verify tool-call signatures |
| `VERIFICATION_SECRET` | Local, Vercel (sensitive) | Sign verification tokens; admin reset token. **Local and production values currently differ.** |
| `PUBLIC_BASE_URL` | Local | Base URL of the deployed backend, used by scripts |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (+ `KV_URL`, `REDIS_URL`, read-only token) | Vercel (sensitive, managed by Upstash integration) | Redis attempt counter; optional locally |

---

## 10. Runbook

**Change Maya**
1. Edit `src/agent/prompt.ts` (bump `PROMPT_VERSION`, add a note) or `src/agent/config.ts`.
2. `npm test` and `npm run typecheck`.
3. `TARGET=eval npm run agent:sync`, then optionally `ONLY="phone path" npx tsx --env-file=.env.local scripts/replay.mts` (paid).
4. `npm run agent:sync` (live draft), then `npm run agent:publish -- "vX: what changed"`.
5. One real call. Commit with the reason.

**Change the backend:** edit, `npm test`, `vercel deploy --prod --yes`, then commit.

**Edited something in the voice platform dashboard?** Copy the settings into `src/agent/config.ts` and re-pin. A dashboard publish does **not** move the phone number.

**Gotchas learned the hard way**
- `vercel env pull` / integration installs **overwrite `.env.local`**; sensitive values can't be pulled back. Use `--no-env-pull`.
- Rotating Upstash credentials breaks production until the next deploy (the memory fallback now keeps verification working).
- `/api/admin/reset` needs the token from the **production** `VERIFICATION_SECRET`; the local value differs, so local reset calls return 401.
- Playground replays cost model calls on the voice platform account: agree a call count first and use `ONLY=`.
- The voice platform strips `default` from tool schemas; that's expected, not drift.

---

## 11. Known limitations

- Scorecard targets defined but not measured at scale (no simulation run yet).
- Plans, links, tickets, holds and logs are in memory (reset on deploy); only the attempt lock is shared.
- Business-hours transfers are simulated.
- Expressive mode is on with a non-platform voice (documented as unsupported); the next suspect if speech is still choppy.
- English, inbound only.

## 12. Next steps (not started)

1. **Simulation and scoring:** simulated callers across all scenarios, scored against the scorecard.
2. **Ops dashboard:** calls, transcripts, scores, failure types; move state to a database.
3. **v2 + steering-committee memo:** fix the top failure types, re-run, report before/after.

