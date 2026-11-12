// One test block per scenario in docs/01-use-case.md, exercising the same
// tool calls Maya will make on a real call.

import { beforeEach, describe, expect, it } from "vitest";
import { resetStore, store } from "@/lib/clinic/store";
import { runTool, type ToolContext } from "@/lib/clinic/tools";

// Wednesday 2026-11-11, 2:00 PM Eastern (business hours)
const OPEN = new Date("2026-11-11T19:00:00Z");
// Saturday 2026-11-14, 10:00 AM Eastern (closed)
const CLOSED = new Date("2026-11-14T15:00:00Z");

let ctx: ToolContext;
let callN = 0;
beforeEach(() => {
  resetStore();
  ctx = { callId: `call_test_${++callN}`, now: OPEN };
});

const run = (tool: Parameters<typeof runTool>[0], args: Record<string, unknown>, c = ctx) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests poke at nested result fields
  runTool(tool, args, c) as Record<string, any>;

function verify(first: string, last: string, dob: string, extra: Record<string, string>) {
  const r = run("verify_patient", { first_name: first, last_name: last, date_of_birth: dob, ...extra });
  expect(r.ok).toBe(true);
  return r.verification_token as string;
}

describe("Rule 1: identity before account details", () => {
  it("refuses account tools without a token", () => {
    for (const tool of ["get_statement", "get_claim_status", "send_payment_link"] as const) {
      expect(run(tool, {})).toMatchObject({ ok: false, error: "caller_not_verified" });
    }
    const r = run("get_statement", { verification_token: "forged.token" });
    expect(r).toMatchObject({ ok: false, error: "caller_not_verified" });
  });

  it("rejects a token from a different call (no replay)", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const other = { ...ctx, callId: "call_someone_else" };
    expect(run("get_statement", { verification_token: token }, other)).toMatchObject({ ok: false });
  });

  it("rejects an expired token", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const later = { ...ctx, now: new Date(OPEN.getTime() + 2 * 60 * 60 * 1000) };
    expect(run("get_statement", { verification_token: token }, later)).toMatchObject({ ok: false });
  });

  it("accepts nickname, account number without prefix, or phone on file", () => {
    verify("Dan", "Reyes", "1984-03-14", { account_number: "104218" });
    verify("daniel", "REYES", "1984-03-14", { phone: "(212) 555-0142" });
  });

  // Regressions from the first real phone call (2026-11-11).
  it("accepts a misheard last name when DOB and account number match exactly ('Reese' for 'Reyes')", () => {
    const r = run("verify_patient", {
      first_name: "Daniel",
      last_name: "Reese",
      date_of_birth: "1984-03-14",
      account_number: "HO-104218",
    });
    expect(r).toMatchObject({ ok: true, first_name: "Daniel" });
    // The match type is audit-only: shown to the agent, it got narrated on a live call.
    expect(r).not.toHaveProperty("_audit");
    expect(store.toolCalls.at(-1)?.audit).toEqual({ name_match: "sounds_alike" });
  });

  // Real call (v1.5): "Ayesha" transcribed for "Aisha" failed all three attempts.
  it("accepts a first name spelled differently by speech-to-text", () => {
    verify("Ayesha", "Khan", "1999-04-25", { phone: "646 555 0151" });
    verify("Aysha", "Khan", "1999-04-25", { account_number: "H o one zero four four zero two" });
  });

  it("still rejects a sound-alike name when DOB is wrong", () => {
    const r = run("verify_patient", { first_name: "Ayesha", last_name: "Khan", date_of_birth: "1999-04-26", phone: "6465550151" });
    expect(r).toMatchObject({ ok: false, error: "not_verified" });
  });

  it("rejects a clearly different first name even with everything else right", () => {
    const r = run("verify_patient", { first_name: "Kevin", last_name: "Khan", date_of_birth: "1999-04-25", phone: "6465550151" });
    expect(r).toMatchObject({ ok: false, error: "not_verified" });
  });

  it("accepts the ways real calls mangled 'H O' in the account number", () => {
    verify("Daniel", "Reyes", "1984-03-14", { account_number: "H0104218" });
    verify("Daniel", "Reyes", "1984-03-14", { account_number: "H 0 1 0 4 2 1 8" });
    verify("Daniel", "Reyes", "1984-03-14", { account_number: "Eight zero one zero four two one eight" });
    verify("Daniel", "Reyes", "1984-03-14", { account_number: "Hho104218" });
  });

  it("does not accept a wrong six-digit core", () => {
    const r = run("verify_patient", { first_name: "Daniel", last_name: "Reyes", date_of_birth: "1984-03-14", account_number: "HO-104281" });
    expect(r).toMatchObject({ ok: false, error: "not_verified" });
  });

  it("understands numbers passed as spoken words", () => {
    verify("Daniel", "Reese", "1984-03-14", { account_number: "H O one zero four two one eight" });
    verify("Daniel", "Reyes", "1984-03-14", { phone: "two one two five five five oh one four two" });
    verify("Priya", "Shah", "1991-07-02", { phone: "seven one eight, triple five, zero one eight seven" });
  });

  it("still rejects a sound-alike name when the second factor is wrong", () => {
    const r = run("verify_patient", {
      first_name: "Daniel",
      last_name: "Reese",
      date_of_birth: "1984-03-14",
      account_number: "HO-104219",
    });
    expect(r).toMatchObject({ ok: false, error: "not_verified" });
  });

  // Real call: 3 failures, then a 4th attempt went through because the counter
  // lived in one server's memory. Production passes the shared (Redis) count in.
  it("locks after 3 failures counted elsewhere (shared storage)", () => {
    const shared = { ...ctx, priorVerificationFailures: 3 };
    const r = run("verify_patient", { first_name: "Aisha", last_name: "Khan", date_of_birth: "1999-04-25", phone: "6465550151" }, shared);
    expect(r).toMatchObject({ ok: false, error: "verification_locked" });
  });

  it("treats a cut-off phone number as incomplete without using up an attempt", () => {
    const short = { first_name: "Daniel", last_name: "Reyes", date_of_birth: "1984-03-14", phone: "212555014" };
    for (let i = 0; i < 5; i++) expect(run("verify_patient", short)).toMatchObject({ ok: false, error: "incomplete_input" });
    verify("Daniel", "Reyes", "1984-03-14", { phone: "212 555 0142" });
  });

  it("requires name + DOB + a second factor", () => {
    const r = run("verify_patient", { first_name: "Daniel", last_name: "Reyes", date_of_birth: "1984-03-14" });
    expect(r).toMatchObject({ ok: false, error: "invalid_arguments" });
  });
});

describe("A: MRI deductible surprise → explanation + payment plan", () => {
  it("explains the bill with exact numbers", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const s = run("get_statement", { verification_token: token });
    expect(s.totals.current_balance).toBe(1150);
    expect(s.charges[0].explanation).toContain("$2,400");
    expect(s.charges[0].explanation).toContain("$1,250 was written off");
    expect(s.charges[0].explanation).toContain("deductible");
    expect(s.insurance.deductible).toEqual({ annual: 2000, met_before_these_charges: 850 });
  });

  it("quotes exact plan amounts that match what the plan creates", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const s = run("get_statement", { verification_token: token });
    const six = s.payment_options.find((o: { months?: number }) => o.months === 6);
    expect(six).toMatchObject({ monthly_amount: 191.66, final_payment: 191.7 });
    // Hardship-length plans aren't offered as a standard option.
    expect(s.payment_options.some((o: { months?: number }) => (o.months ?? 0) > 6)).toBe(false);
    const p = run("create_payment_plan", { verification_token: token, type: "installments", months: 6 });
    expect(p.monthly_amount).toBe(six.monthly_amount);
  });

  it("offers pay-in-full or deferral for small balances", () => {
    const token = verify("Aisha", "Khan", "1999-04-25", { phone: "6465550151" });
    const opts = run("get_statement", { verification_token: token }).payment_options;
    expect(opts.map((o: { option: string }) => o.option)).toEqual(["pay_in_full", "defer"]);
  });

  it("creates a 6-month plan automatically", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const p = run("create_payment_plan", { verification_token: token, type: "installments", months: 6 });
    expect(p).toMatchObject({ ok: true, status: "active", months: 6, monthly_amount: 191.66 });
    const plan = store.paymentPlans[0];
    expect(plan.schedule.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1150, 2);
    // A second plan is refused
    expect(run("create_payment_plan", { verification_token: token, type: "installments", months: 3 })).toMatchObject({
      ok: false,
      error: "plan_exists",
    });
  });

  // From the GPT-4.1 replay: it flagged hardship on its own when the caller
  // only asked for 12 months. Hardship now needs the caller's stated reason.
  it("treats hardship without a stated reason as no hardship", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    expect(
      run("create_payment_plan", { verification_token: token, type: "installments", months: 12, hardship: true }),
    ).toMatchObject({ ok: false, error: "needs_hardship" });
    expect(
      run("create_payment_plan", { verification_token: token, type: "installments", months: 12, hardship_reason: "short" }),
    ).toMatchObject({ ok: false, error: "invalid_arguments" });
  });

  it("lets a pending 12-month request be swapped for 6 months", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    run("create_payment_plan", { verification_token: token, type: "installments", months: 12, hardship_reason: "my hours were cut" });
    expect(store.tickets).toHaveLength(1);
    const six = run("create_payment_plan", { verification_token: token, type: "installments", months: 6 });
    expect(six).toMatchObject({ ok: true, status: "active", months: 6, replaced_pending_plan: "PLN-00001" });
    expect(store.paymentPlans).toHaveLength(1);
    expect(store.tickets).toHaveLength(0);
  });

  it("won't go past 6 months without hardship", () => {
    const token = verify("Daniel", "Reyes", "1984-03-14", { account_number: "HO-104218" });
    const p = run("create_payment_plan", { verification_token: token, type: "installments", months: 10 });
    expect(p).toMatchObject({ ok: false, error: "needs_hardship" });
  });
});

describe("B: physical therapy coinsurance across 8 visits", () => {
  it("explains each visit as 20% coinsurance", () => {
    const token = verify("Priya", "Shah", "1991-07-02", { phone: "7185550187" });
    const s = run("get_statement", { verification_token: token });
    expect(s.charges).toHaveLength(8);
    for (const c of s.charges) {
      expect(c.patient_owes).toBe(30);
      expect(c.explanation).toContain("20% coinsurance");
    }
    expect(s.totals.current_balance).toBe(240);
  });
});

describe("C: claim denied for coordination of benefits → insurance update", () => {
  it("identifies the denial as fixable, updates insurance, and holds the balance", () => {
    const token = verify("Marcus", "Bell", "1978-11-30", { account_number: "HO-103952" });
    const c = run("get_claim_status", { verification_token: token });
    expect(c.claims[0]).toMatchObject({ status: "denied", agent_can_fix: true, denial: { code: "CO-22" } });

    const u = run("update_insurance", {
      verification_token: token,
      claim_id: "CLM-C1",
      payer: "Aetna",
      member_id: "W990127734",
      effective_date: "2026-07-01",
    });
    expect(u).toMatchObject({ ok: true, claim_status: "resubmission_pending", amount_on_hold: 685 });

    const s = run("get_statement", { verification_token: token });
    expect(s.totals).toMatchObject({ current_balance: 685, on_hold: 685, due_now: 0 });
    // No payment link while on hold
    expect(run("send_payment_link", { verification_token: token })).toMatchObject({ ok: false, error: "nothing_due" });
    // Status now reflects the resubmission
    expect(run("get_claim_status", { verification_token: token }).claims[0].status).toBe("resubmission_pending");
  });

  it("rejects coverage that started after the visit", () => {
    const token = verify("Marcus", "Bell", "1978-11-30", { account_number: "HO-103952" });
    const u = run("update_insurance", {
      verification_token: token,
      claim_id: "CLM-C1",
      payer: "Aetna",
      member_id: "W990127734",
      effective_date: "2026-09-01",
    });
    expect(u).toMatchObject({ ok: false, error: "coverage_starts_after_service" });
  });
});

describe("D: out-of-network surprise → escalate, don't fix", () => {
  it("marks the claim as not agent-fixable and holds the balance once a review ticket is opened", () => {
    const token = verify("Linda", "Okafor", "1969-05-21", { phone: "9175550163" });
    const c = run("get_claim_status", { verification_token: token, claim_id: "CLM-D1" });
    expect(c.claims[0]).toMatchObject({ status: "paid", agent_can_fix: false });
    expect(c.claims[0].next_step).toContain("out_of_network_review");

    // update_insurance is refused
    expect(
      run("update_insurance", {
        verification_token: token,
        claim_id: "CLM-D1",
        payer: "Oscar",
        member_id: "OSC2219874",
        effective_date: "2026-01-01",
      }),
    ).toMatchObject({ ok: false, error: "not_fixable_by_agent" });

    const t = run("create_ticket", {
      verification_token: token,
      category: "out_of_network_review",
      claim_id: "CLM-D1",
      summary: "Patient says scheduling told her Harbor was in network for Oscar EPO; surgery processed OON, $3,150 balance.",
    });
    expect(t).toMatchObject({ ok: true, hold: { amount: 3150 } });
    expect(run("get_statement", { verification_token: token }).totals.due_now).toBe(0);
  });
});

describe("E: already paid after the statement went out", () => {
  it("shows a zero balance and the payment", () => {
    const token = verify("James", "Whitfield", "1956-02-09", { account_number: "HO-103785" });
    const s = run("get_statement", { verification_token: token });
    expect(s.totals.current_balance).toBe(0);
    expect(s.totals.payments_received_since_statement).toEqual([{ date: "2026-11-03", amount: 320 }]);
    expect(s.agent_guidance).toContain("paid in full");
    expect(run("send_payment_link", { verification_token: token })).toMatchObject({ ok: false });
  });
});

describe("F: financial hardship", () => {
  it("offers 6 months automatically, and routes 12 months for approval", () => {
    const token = verify("Rosa", "Delgado", "1988-12-12", { account_number: "HO-103866" });
    const p = run("create_payment_plan", { verification_token: token, type: "installments", months: 12, hardship_reason: "I lost my job last month" });
    expect(p).toMatchObject({ ok: true, status: "pending_approval", monthly_amount: 200 });
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0].category).toBe("payment_plan_approval");
    expect(p.agent_guidance).toContain("Don't say it's approved");
  });
});

describe("G: angry caller demands a human", () => {
  it("transfers during business hours with handoff notes", () => {
    const r = run("transfer_to_human", {
      reason: "caller_requested",
      summary: "Caller is upset about a $560 bill and asked for a supervisor right away.",
    });
    expect(r).toMatchObject({ ok: true, status: "transferring" });
    expect(store.tickets[0].category).toBe("human_handoff");
  });

  it("books a callback after hours", () => {
    ctx = { ...ctx, now: CLOSED };
    const token = verify("Kevin", "Brooks", "1975-09-03", { account_number: "HO-104150" });
    const r = run("transfer_to_human", {
      verification_token: token,
      reason: "caller_requested",
      summary: "Wants a supervisor about the knee brace charge.",
    });
    expect(r).toMatchObject({ ok: true, status: "callback_scheduled" });
    expect(store.tickets[0].callbackPhone).toBe("2125550196");
  });
});

describe("H: spouse calls about Kevin's account and fails verification", () => {
  it("never reveals which detail was wrong, and locks after 3 attempts", () => {
    const attempt = () =>
      run("verify_patient", {
        first_name: "Kevin",
        last_name: "Brooks",
        date_of_birth: "1977-02-11", // spouse's own DOB
        phone: "2125550196",
      });
    const first = attempt();
    expect(first).toMatchObject({ ok: false, error: "not_verified", attempts_remaining: 2 });
    expect(JSON.stringify(first)).not.toMatch(/1975|Brooks|balance|560/);
    attempt();
    expect(attempt()).toMatchObject({ ok: false, attempts_remaining: 0 });
    // Even the right details are refused once locked on this call
    expect(
      run("verify_patient", { first_name: "Kevin", last_name: "Brooks", date_of_birth: "1975-09-03", phone: "2125550196" }),
    ).toMatchObject({ ok: false, error: "verification_locked" });

    const t = run("create_ticket", {
      category: "verification_failed",
      summary: "Caller identified as the patient's spouse; could not verify. Requested callback for the patient.",
      callback_phone: "212-555-0177",
    });
    expect(t.ok).toBe(true);
  });
});

describe("I: small balance, pay now", () => {
  it("sends a pay link to the masked phone on file", () => {
    const token = verify("Aisha", "Khan", "1999-04-25", { phone: "6465550151" });
    const r = run("send_payment_link", { verification_token: token });
    expect(r).toMatchObject({ ok: true, amount: 85, sent_to: "(646) •••-0151" });
    expect(JSON.stringify(r)).not.toContain("6465550151");
  });

  it("can't put $85 on installments, but can defer up to 30 days", () => {
    const token = verify("Aisha", "Khan", "1999-04-25", { phone: "6465550151" });
    expect(run("create_payment_plan", { verification_token: token, type: "installments", months: 2 })).toMatchObject({
      ok: false,
      error: "below_plan_minimum",
    });
    expect(
      run("create_payment_plan", { verification_token: token, type: "deferred", deferred_due_date: "2026-12-31" }),
    ).toMatchObject({ ok: false, error: "invalid_deferral_date" });
    expect(
      run("create_payment_plan", { verification_token: token, type: "deferred", deferred_due_date: "2026-12-05" }),
    ).toMatchObject({ ok: true });
  });

  it("refuses to charge more than is owed", () => {
    const token = verify("Aisha", "Khan", "1999-04-25", { phone: "6465550151" });
    expect(run("send_payment_link", { verification_token: token, amount: 500 })).toMatchObject({
      ok: false,
      error: "amount_exceeds_balance",
    });
  });
});

describe("audit log", () => {
  it("logs every tool call with the token redacted", () => {
    const token = verify("Aisha", "Khan", "1999-04-25", { phone: "6465550151" });
    run("get_statement", { verification_token: token });
    expect(store.toolCalls).toHaveLength(2);
    expect(store.toolCalls[1].args.verification_token).toBe("[redacted]");
    expect(store.toolCalls.every((c) => c.callId === ctx.callId)).toBe(true);
  });
});
