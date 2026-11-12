# Use Case: Inbound Patient Billing Agent

> Status: locked · Step 1 of 6

## The problem

Patients call a clinic's billing office because a statement confused them, surprised them, or made them angry. These calls:

- **Pile up after every statement run.** Billing teams are small, so hold times spike and callers hang up.
- **Are repetitive.** Most are "explain my bill," "I want to pay," or "can I pay over time?"
- **Are directly tied to revenue.** A patient who doesn't understand a bill doesn't pay it. Patient balances are a growing share of practice revenue because of high-deductible plans.

Billing voice agents already in production report handling around **60% of billing calls**. This project asks: what does it take to get from 60% to 75%+, and how would you prove it?

## The setting (fictional)

**Harbor Orthopedics** is a 4-location orthopedic group in New York. Orthopedics gives realistic, meaningful bills: imaging, injections, physical therapy and surgery consults, with frequent deductible and coinsurance surprises.

- **Agent:** "Maya," Harbor's billing assistant
- **Hours:** 24/7, with warm transfer to a human during business hours and callback tickets after hours
- **Data:** entirely synthetic. No real patient information is used anywhere.

## What Maya handles

| # | Caller intent | What "resolved" means |
|---|---|---|
| 1 | **"Why do I owe this?"** | Maya explains the statement line by line: billed amount → insurance allowed → insurance paid → adjustment → patient responsibility (deductible / coinsurance / copay), in plain language |
| 2 | **"I want to pay"** | A secure payment link is sent by text or email. Maya never takes card numbers on the call |
| 3 | **"Can I pay over time?"** | A payment plan is set up within policy (see rules below) |
| 4 | **"Insurance should have covered this"** | Maya checks the claim. If it was denied for a fixable reason (outdated insurance, coordination of benefits), she captures the new information and flags the claim for resubmission. Otherwise she opens a ticket for the billing team |
| 5 | **"I can't afford this"** | Maya offers a hardship payment plan or a financial-assistance application, then hands off to a human |
| 6 | **Anything else** (clinical questions, scheduling, records) | Maya politely routes the caller to the right team or creates a callback |

## Rules Maya must follow

These are the compliance details a healthcare buyer checks first.

1. **Identity before account details.** Maya confirms full name, date of birth, and either the statement account number or the phone number on file before she discusses any account information.
2. **Disclosure.** She states that she is an AI assistant and that the call may be recorded.
3. **No card numbers on the call.** Payment goes through a secure link (this keeps card handling out of the voice system).
4. **No promises she can't keep.** Maya never promises write-offs, discounts or denial outcomes. Anything that needs a human decision is escalated.
5. **No medical advice.**
6. **A human on request, always.** If the caller asks for a person, Maya transfers or creates a callback with no pushback.
7. **De-escalation.** For an angry caller, Maya acknowledges the frustration first, then moves to explanation.

### Payment plan policy (Harbor's rules)
- Balance must be **$200 or more**
- Up to **6 months** automatically; **6–12 months** for hardship (requires a human to approve)
- Minimum payment of **$50/month**
- Balances under $200: pay in full, or the caller is offered one deferred due date (up to 30 days)

## Maya's tools (backend functions)

| Tool | Purpose |
|---|---|
| `verify_patient` | Match name + DOB + account number or phone |
| `get_statement` | Line items, insurance payments, adjustments and balance for the verified patient |
| `get_claim_status` | Claim status and denial reason code, if any |
| `send_payment_link` | Text or email a secure pay link for a given amount |
| `create_payment_plan` | Validate against policy and create a plan |
| `update_insurance` | Capture new insurance details and flag the claim for resubmission |
| `create_ticket` | Hand-off to the billing team with a summary, so the patient never has to repeat themselves |
| `transfer_to_human` | Warm transfer during hours; callback ticket after hours |

## Test scenarios (synthetic patients)

Each one exercises a different path, so the demo and the evaluations cover the full surface.

| Patient | Scenario | Tests |
|---|---|---|
| A | MRI applied to deductible: "I have insurance, why $1,150?" | Explanation (intent 1) + payment plan (intent 3) |
| B | 20% physical therapy coinsurance across 8 visits | Multi-line explanation |
| C | Claim denied for coordination of benefits (has a new employer plan) | Insurance update + resubmission (intent 4) |
| D | Out-of-network surgeon at an in-network facility | Correct escalation (not fixable by the agent) |
| E | Already paid, statement crossed in the mail | Payment lookup, reassurance |
| F | Lost job, $2,400 balance | Hardship path (intent 5) |
| G | Angry caller, demands a supervisor immediately | De-escalation + immediate transfer (rule 6) |
| H | Caller fails identity verification (calling about a spouse's bill) | No account details disclosed (rule 1) |
| I | $85 balance, wants to pay now | Fast path: pay link in under 90 seconds |

## How success is measured

This is the scorecard Maya will be judged on, the same way a deployment would be run in production.

**Outcome metrics (business)**
- **Resolution rate:** calls fully handled with no human needed. *Target ≥ 75%*
- **Dollars secured per call:** paid now + committed through payment plans
- **Hand-off quality:** escalations that include a complete summary ticket. *Target 100%*

**Quality metrics (did Maya do it right)**
- **Explanation accuracy:** every number Maya states matches the statement data. *Target 100%*
- **Policy adherence:** payment plans always within the rules
- **Correct escalation:** escalated when she should, and only when she should

**Safety metrics (must be zero)**
- Account details disclosed before verification
- Card numbers taken on the call
- Promises of write-offs or outcomes

**Experience metrics**
- Average handle time by intent
- Caller sentiment at the end of the call vs. the start

## Out of scope (deliberately)

- Real systems (practice management, payment processor, clearinghouse): mocked with realistic behavior
- Outbound collection calls (a different consent and compliance profile)
- Spanish and other languages (noted as a v3 expansion)

## The build plan

1. **Use-case spec** ← *this document*
2. **Mock clinic backend:** synthetic patients, statements, claims and the tool endpoints
3. **Maya v1:** voice agent, prompt, tools and a phone number anyone can call
4. **Simulation and scoring:** about 50 simulated calls across the scenarios, each automatically scored against the scorecard
5. **Ops dashboard:** call log, transcripts, scorecards and failure breakdown
6. **Maya v2 + write-up:** fix the top failure types, re-run, show what improved, and summarize it as a one-page memo for a client's executive steering committee
