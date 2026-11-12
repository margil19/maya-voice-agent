# Step 3: Maya on the voice platform (v1 → v1.6)

> Status: done · Step 3 of 6

Maya is live as a voice agent, wired to the clinic backend deployed at `https://maya-voice-agent-demo.vercel.app`.

## How the pieces fit

```
Caller ──voice──▶ Voice AI platform (Maya: voice, speech recognition, prompt, Claude Sonnet 5.5)
                     │
                     │  signed HTTPS tool calls
                     ▼
               Vercel: /api/tools/<tool>  (Harbor's "billing system": patients, rules, audit log)
```

The voice platform runs the conversation. The backend plays the role a customer's EHR or practice management system would play in a real deployment.

## Configuration as code

Maya isn't clicked together in the dashboard. Her whole setup lives in this repository:

| File | What it holds |
|---|---|
| `src/agent/prompt.ts` | The system prompt, with a version number and a change note for every revision |
| `src/agent/config.ts` | Model, voice, speech settings, tool wiring and post-call analysis fields |
| `scripts/sync-agent.mts` | Creates Maya in the voice platform the first time and updates her afterwards (`npm run agent:sync`) |
| `scripts/smoke-chat.mts` | A scripted text conversation through the voice platform's playground (`npm run agent:smoke`) |
| `retell.json` | The voice platform IDs for Maya, so re-running the sync never creates duplicates |

Tool definitions sent to the voice platform are generated from the same validation schemas the backend enforces, so the agent and the backend can't drift apart.

## Key settings

| Setting | Value | Why |
|---|---|---|
| Model | Claude Sonnet 5.5, temperature 0.2 | Strong instruction-following at voice latency; low temperature for consistent numbers |
| Voice | ElevenLabs "Merritt" | Calm, middle-aged American voice suited to money conversations |
| Speech recognition | Medical vocabulary, boosted payer names and billing terms | "Coinsurance" and "Oscar" must not be misheard |
| Post-call analysis | Intent, resolved without a human, escalated, dollars committed, caller's mood at the end, compliance concerns | Raw material for the scorecard in steps 4 and 5 |

## Security

Every tool request must carry a signature header from the voice platform: an HMAC of the request body made with the account's **webhook-badged** API key (`RETELL_WEBHOOK_KEY`). Anything unsigned or forged gets a 401. Secrets live in `.env.local` locally and in Vercel's encrypted environment variables, never in git.

## What testing found

| # | Finding | What we did |
|---|---|---|
| 1 | All tool calls returned 401: the voice platform signs with the webhook-badged key, not the key used to manage agents | Added `RETELL_WEBHOOK_KEY` |
| 2 | **Maya failed safely under a full tool outage:** she disclosed nothing, tried a ticket and then a transfer, and told the caller honestly that nothing had been shared or changed | Kept as a design win: failure behavior matters as much as the happy path |
| 3 | Maya spoke her internal reasoning out loud ("The caller's message included a block of date and time text…") | Prompt **v1.1**: everything she outputs is spoken; never narrate reasoning or system text |

After the fixes, scenario I (Aisha, $85 to pay) completed end to end: verify → statement → both copays explained with exact numbers → pay link to her masked phone → recap → end call.

## First real phone calls → v1.2

Two real calls to (401) 399-6716 on 2026-11-11, pulled from the voice platform (transcripts, tool calls, latency):

| What the caller experienced | Root cause in the data | Fix |
|---|---|---|
| "Couldn't verify Daniel's account" | Speech-to-text heard **"Reese"** for "Reyes". DOB and account number were captured perfectly; the backend demanded an exact last-name match | Last name may match **by sound** (Soundex), but only when DOB **and** the account number/phone match exactly. "H zero" is accepted for "H O". Regression tests added from the real call |
| "Only nine digits" loop | The caller said all 10 digits. **The model miscounted** (it even wrote all 10 out) and refused to proceed | Maya never counts digits; the backend checks them. A cut-off number returns `incomplete_input` and doesn't use up a verification attempt |
| Maya spoke her reasoning ("The phone number given is…, I should ask again") | The model narrated around tool calls; the v1.1 rule wasn't strong enough | Prompt v1.2 puts "you are speaking out loud" first, with concrete bad examples, and repeats it at the end |
| "Harsh, rude, like she's doing you a favour" | Wording ("I'm sorry, but I can't…", "Here are two options"), voice, and **2.3 s median silence** before each reply | Prompt v1.2 tone section (warmth first, "what I *can* do" before "can't", blame the phone line, not the caller); voice changed to the voice platform "Kate" with expressive mode; faster models evaluated (below) |

### Model comparison

The same three conversations, built from the real calls (including the "Reese" mishearing), replayed on each model through the voice platform (`scripts/replay.mts`):

| Model | Verified correctly | Narration leaks | Median reply | Conversation quality |
|---|---|---|---|---|
| **Claude Sonnet 5.5** | ✅ | 1 | 1.7 s | Best: full, clear deductible explanation; handled the spouse kindly |
| Claude Haiku 5.5 | ❌ phone path | 1 | 1.1 s | Fast, but got stuck re-asking for verification |
| GPT-5.4 mini | ❌ account path | 0 | 1.5–2.2 s | Kept the caller stuck in a verification loop for the whole call |
| Gemini 3.5 Flash | ✅ | 0 | 1.5 s | Skipped the actual explanation; asked the spouse for the patient's DOB |

**Kept Sonnet:** explaining the bill correctly is the core job, and the faster models failed it.

### What iteration showed

| Change | Result |
|---|---|
| Prompt rules with "never say..." examples | Leaks moved, didn't stop. The model sometimes recited the new rule itself |
| Field description "send what they said" | **Broke verification**: the model sent the words "H O one zero four...". Fixed in the backend: spoken numbers ("one zero four", "oh", "triple five") are normalized server-side, whatever the model sends |
| A fixed spoken line for every tool call | Removed the improvised narration around most tool calls |
| Stating the phone-number pattern as a fact (3 + 3 + 4 digits) | Reduced, but didn't eliminate, "only nine digits" miscounts |

**Published as v1.2 (platform version 0):** verification passed 9 of 9 replays, and tone and voice were fixed. **Known remaining issue:** about one in three replayed conversations still has one narrated line, almost always about a phone number. Prompt changes have plateaued, so the next fix is structural (see Next).

### v1.3 → v1.6: three more real calls

| Version | Found (real call or small replay) | Fixed |
|---|---|---|
| v1.3 | Narrated a self-correction ("I stated a monthly figure last turn that didn't come from a tool") after rounding an amount | Rule: exact figures only, never comment on earlier ones. The name-match type became audit-only, because Maya narrated it ("the tool says it sounds alike") |
| v1.4 | Sonnet still narrated in about half of replays. The voice platform community reports the same with reasoning models | **Switched to GPT-4.1:** zero narration in a targeted ~15-call replay, ~1.2 s replies. GPT-4.1 flagged hardship on its own, so hardship now needs the caller's stated reason, and a pending plan can be swapped |
| v1.5 | "H O" heard as "eight zero"; quoted "about one ninety-two" from its own math; offered the 12-month hardship plan unprompted | Account numbers matched on their six digits. `get_statement` returns exact `payment_options` computed by the same code that creates plans. Hardship plans aren't mentioned unless the caller raises money trouble |
| v1.6 | "Ayesha" transcribed for "Aisha" failed all three attempts, and a **fourth attempt got through**: the attempt counter lived in one server's memory | First names match by sound (DOB and account/phone still exact). The 3-try lock moved to **Upstash Redis** (Vercel Marketplace), falling back to memory if Redis is unreachable. Voice changed to "Grace" with a soft call-center background, tuned by ear in the voice platform dashboard and copied into code |

**Cost discipline:** after the first wide model comparison used a few hundred paid completions, test runs became targeted (one model, one or two conversations, call count agreed up front), and free checks (unit tests, signed backend requests) came first.

**Production practice adopted:** the phone number is pinned to a **published** version. All changes go to a draft and a separate test copy of Maya; a version reaches callers only through `npm run agent:publish`.

## Next

Step 4 runs simulated callers through all nine scenarios and scores each call against the scorecard from the use-case spec. Leak rate becomes a tracked safety metric there.

Candidate structural fix for the remaining leaks: run Maya's conversation loop ourselves through the voice platform's custom-LLM connection, so every reply passes through a guard that strips narration before it's spoken, and spoken numbers are parsed in code rather than by the model.
