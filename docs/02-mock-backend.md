# Step 2: Mock Clinic Backend

> Status: done · Step 2 of 6

The backend Maya talks to during a call: synthetic patients and the eight tools from the spec, served as HTTP endpoints the voice platform can call.

## Design decisions

| Decision | Why |
|---|---|
| **Rules are enforced in the backend, not only in the prompt** | Prompts drift; code doesn't. Even if Maya were talked into skipping verification, the backend would still refuse to return account data. |
| **Verification issues a signed token tied to the call** | Every account tool requires it. It expires after an hour and can't be reused on a different call. |
| **Failed verification never says which detail was wrong**, and it locks after 3 attempts | Stops someone guessing their way into an account (scenario H). |
| **Every tool result includes `agent_guidance`** | The backend tells Maya what to say next, including on failures, so she never has to improvise around an error. |
| **Payment plan policy lives in code** | Maya can't offer a plan that breaks Harbor's rules. Plans over 6 months become "pending approval", with a ticket for the billing team. |
| **Disputes and insurance fixes put the balance on hold** | Patients aren't chased for money that's under review, which matters for both patient trust and compliance. |
| **Pay links go only to the contact details on file, masked** | No card numbers on the call, and no sending payment links to a number a caller just made up. |
| **Every tool call is logged, with tokens redacted** | This becomes the raw data for the ops dashboard in step 5. |

## Where things are

| Path | What it is |
|---|---|
| `src/lib/clinic/data.ts` | The 8 synthetic patients, their statements and insurance claims |
| `src/lib/clinic/verification.ts` | Identity matching and signed tokens |
| `src/lib/clinic/policy.ts` | Payment plan rules, business hours, balance math, plain-language explanations |
| `src/lib/clinic/tools.ts` | The 8 tools: input validation, rules, and responses |
| `src/lib/clinic/store.ts` | In-memory record of plans, links, tickets, holds and the tool-call log (replaced by a database in step 5) |
| `src/lib/clinic/attempts.ts` | Per-call failed-verification counter in Upstash Redis (added in step 3) |
| `src/app/api/tools/[tool]/route.ts` | `POST /api/tools/<tool>`: the endpoint the voice platform calls |
| `src/app/api/tools/route.ts` | `GET /api/tools`: lists the tools and their input schemas |
| `tests/` | Data consistency, every scenario from the spec, and regression tests added from real calls |

## Test patients

| Scenario | Name | DOB | Account | Phone on file | Balance |
|---|---|---|---|---|---|
| A | Daniel Reyes | 1984-03-14 | HO-104218 | (212) 555-0142 | $1,150 |
| B | Priya Shah | 1991-07-02 | HO-104377 | (718) 555-0187 | $240 |
| C | Marcus Bell | 1978-11-30 | HO-103952 | (646) 555-0119 | $685 |
| D | Linda Okafor | 1969-05-21 | HO-104011 | (917) 555-0163 | $3,150 |
| E | James Whitfield | 1956-02-09 | HO-103785 | (347) 555-0128 | $0 (paid) |
| F | Rosa Delgado | 1988-12-12 | HO-103866 | (929) 555-0174 | $2,400 |
| G / H | Kevin Brooks | 1975-09-03 | HO-104150 | (212) 555-0196 | $560 |
| I | Aisha Khan | 1999-04-25 | HO-104402 | (646) 555-0151 | $85 |

## Running it

```bash
npm run dev        # http://localhost:3000/api/tools
npm test
npm run typecheck
```

Example call in the voice platform's request format:

```bash
curl -X POST http://localhost:3000/api/tools/verify_patient \
  -H 'content-type: application/json' \
  -d '{"call":{"call_id":"demo"},"args":{"first_name":"Daniel","last_name":"Reyes","date_of_birth":"1984-03-14","account_number":"HO-104218"}}'
```

## Known limits

Updated after step 3:

- ~~No request signing.~~ **Done:** every tool request must carry the voice platform's signature (see step 3).
- **Verification attempt lock:** moved to Upstash Redis so it holds across server instances, after a real call got a fourth attempt through. It falls back to memory if Redis is unreachable.
- **Other state is still in memory.** Payment plans, links, tickets, holds and the tool-call log reset when the server restarts and aren't shared across instances. Fine for a demo; a real deployment writes these to the client's systems.
- **"Transfer" during business hours is simulated.** There's no real billing team to ring, so Maya says she's connecting the caller and the handoff notes are recorded.
