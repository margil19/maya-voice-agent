// Maya's tools. Each one validates its input, enforces Harbor's rules in code,
// and returns plain JSON the voice agent reads back to the caller.
//
// Design choices worth noting:
// - Account data is only reachable with a verification token (spec rule 1).
// - Failures return { ok: false, error, agent_guidance } instead of throwing,
//   so the agent always knows what to say next.
// - Policy (payment plans, holds, who can fix what) lives here, not in the prompt.

import { z } from "zod";
import { claims, findPatientById } from "./data";
import {
  HOLD_DAYS,
  PLAN_POLICY,
  accountSummary,
  addDays,
  claimStatus,
  explainLine,
  installmentSchedule,
  isBusinessHours,
  isoDate,
  round2,
  standardPaymentOptions,
  usd,
} from "./policy";
import { nextId, store, type TicketCategory } from "./store";
import { MAX_VERIFICATION_ATTEMPTS, checkToken, findMatchingPatient, incompleteInput, issueToken } from "./verification";
import type { Patient } from "./types";

export type ToolContext = {
  callId?: string;
  now: Date;
  /**
   * Failed verification attempts on this call so far, from shared storage
   * (Redis in production). When absent, the in-memory store is used (tests, dev).
   * Memory alone isn't enough in production: requests on one call can land on
   * different server instances, and a real call got a 4th attempt that way.
   */
  priorVerificationFailures?: number;
};
export type ToolResult = { ok: boolean } & Record<string, unknown>;

type ToolDef<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>, ctx: ToolContext) => ToolResult;
};

const defineTool = <S extends z.ZodType>(t: ToolDef<S>) => t;

const fail = (error: string, agent_guidance: string, extra: Record<string, unknown> = {}): ToolResult => ({
  ok: false,
  error,
  agent_guidance,
  ...extra,
});

const tokenField = z
  .string()
  .describe("The verification_token returned by verify_patient on this call.");

/** Resolve the verified patient or return the failure to send back. */
function requirePatient(token: string | undefined, ctx: ToolContext): Patient | ToolResult {
  const check = checkToken(token, ctx.callId, ctx.now);
  if (!check.ok) {
    return fail(
      "caller_not_verified",
      "Do not share or discuss any account details. Verify the caller with verify_patient first.",
      { reason: check.reason },
    );
  }
  const patient = findPatientById(check.patientId);
  if (!patient) return fail("patient_not_found", "Apologize and offer to transfer to the billing team.");
  return patient;
}

const isFailure = (x: Patient | ToolResult): x is ToolResult => "ok" in x;

const maskPhone = (p: string) => `(${p.slice(0, 3)}) •••-${p.slice(-4)}`;
const maskEmail = (e: string) => {
  const [user, domain] = e.split("@");
  return `${user[0]}•••@${domain}`;
};

// ---------------------------------------------------------------------------

const verifyPatient = defineTool({
  name: "verify_patient",
  description:
    "Verify the caller's identity before discussing anything about an account. Requires full name, date of birth, and either the account number from the statement or the phone number on file.",
  schema: z
    .object({
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      date_of_birth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('Date of birth as YYYY-MM-DD. "three fourteen eighty-four" is 1984-03-14.'),
      account_number: z
        .string()
        .optional()
        .describe('Account number from the statement, written as characters, e.g. HO104218 ("H O one zero four..." or "H zero one zero four..." both mean HO104...).'),
      phone: z
        .string()
        .optional()
        .describe(
          "Phone number on file, written as digits, e.g. 2125550142. Don't count or judge the digits yourself: this tool checks completeness and replies with incomplete_input if part was cut off.",
        ),
    })
    .refine((a) => a.account_number || a.phone, {
      message: "Provide account_number or phone",
    }),
  handler: (args, ctx) => {
    const key = ctx.callId ?? "no-call-id";
    const failures = ctx.priorVerificationFailures ?? store.verificationFailures[key] ?? 0;
    if (failures >= MAX_VERIFICATION_ATTEMPTS) {
      return fail(
        "verification_locked",
        "Too many failed attempts on this call. Do not try again or hint at which detail was wrong. Offer to create a callback ticket (category verification_failed) or transfer to the billing team.",
      );
    }
    const input = {
      firstName: args.first_name,
      lastName: args.last_name,
      dob: args.date_of_birth,
      accountNumber: args.account_number,
      phone: args.phone,
    };
    // Clearly incomplete input (e.g. a phone number cut off mid-way) is a hearing
    // problem, not a wrong answer, so it doesn't use up an attempt.
    const incomplete = incompleteInput(input);
    if (incomplete) {
      return fail(
        "incomplete_input",
        "Part of the number seems to have been cut off. Without counting digits out loud, warmly ask the caller to repeat it slowly. This didn't use up an attempt.",
        { detail: incomplete },
      );
    }
    const match = findMatchingPatient(input);
    if (!match) {
      store.verificationFailures[key] = failures + 1;
      const left = MAX_VERIFICATION_ATTEMPTS - failures - 1;
      return fail(
        "not_verified",
        left > 0
          ? "Gently say you couldn't find a match, without saying which detail. Phone lines can garble names and numbers, so ask them to spell their last name and say the account number or phone number slowly, then try again. If they're calling about someone else's account, kindly explain only the patient can discuss it, and offer a callback for the patient."
          : "That was the last attempt. Don't try again or hint at which detail was wrong. Kindly offer a callback (create_ticket, category verification_failed) or a transfer to the billing team.",
        { attempts_remaining: left },
      );
    }
    const { patient, nameMatch } = match;
    return {
      ok: true,
      verified: true,
      first_name: patient.firstName,
      verification_token: issueToken(patient.id, ctx.callId, ctx.now),
      agent_guidance: "Caller verified. Pass verification_token to every account tool for the rest of this call.",
      // For the audit log only. Shown to the agent, it got narrated on a live
      // call ("the tool says it sounds alike...").
      _audit: { name_match: nameMatch },
    };
  },
});

const getStatement = defineTool({
  name: "get_statement",
  description:
    "Get the verified patient's statement: each charge with a plain-language explanation, insurance payments, adjustments, payments received, current balance, holds and any payment plan.",
  schema: z.object({ verification_token: tokenField }),
  handler: (args, ctx) => {
    const patient = requirePatient(args.verification_token, ctx);
    if (isFailure(patient)) return patient;
    const s = accountSummary(patient, ctx.now);
    const { insurance } = patient;
    return {
      ok: true,
      statement_id: patient.statement.id,
      statement_date: patient.statement.statementDate,
      due_date: patient.statement.dueDate,
      insurance: {
        payer: insurance.payer,
        plan: insurance.planName,
        network_status: insurance.network,
        deductible: insurance.deductible
          ? {
              annual: insurance.deductible.annual,
              met_before_these_charges: insurance.deductible.metBeforeThisClaim,
            }
          : null,
        coinsurance_percent: insurance.coinsurancePct ?? null,
      },
      charges: patient.statement.lines.map((l) => ({
        service_date: l.serviceDate,
        description: l.description,
        billed: l.billed,
        insurance_allowed: l.allowed,
        insurance_paid: l.insurancePaid,
        adjustment: l.adjustment,
        patient_owes: l.patientResponsibility,
        reason: l.responsibilityType,
        claim_id: l.claimId,
        explanation: explainLine(l, patient),
      })),
      totals: {
        statement_charges: s.statementCharges,
        payments_received_since_statement: patient.payments.map((p) => ({ date: p.date, amount: p.amount })),
        current_balance: s.balance,
        on_hold: s.onHold,
        due_now: s.dueNow,
      },
      payment_plan: s.plan
        ? { id: s.plan.id, status: s.plan.status, months: s.plan.months, schedule: s.plan.schedule }
        : null,
      // Exact figures to quote. Never calculate or round amounts yourself.
      payment_options: s.plan ? [] : standardPaymentOptions(s.dueNow, ctx.now),
      agent_guidance:
        s.balance <= 0
          ? `The account is paid in full (payment received after the statement was printed). Reassure the caller that nothing is owed.`
          : `Explain only what the caller asks about, in plain language, using these exact numbers. Never round or estimate. Current balance ${usd(s.balance)}${s.onHold > 0 ? `, of which ${usd(s.onHold)} is on hold` : ""}.`,
    };
  },
});

const getClaimStatus = defineTool({
  name: "get_claim_status",
  description:
    "Check the insurance claim behind a charge: status, denial reason, and whether it is something you can fix on this call.",
  schema: z.object({
    verification_token: tokenField,
    claim_id: z.string().optional().describe("A claim_id from get_statement. Omit to get every claim on the statement."),
  }),
  handler: (args, ctx) => {
    const patient = requirePatient(args.verification_token, ctx);
    if (isFailure(patient)) return patient;
    const ids = [...new Set(patient.statement.lines.map((l) => l.claimId))];
    if (args.claim_id && !ids.includes(args.claim_id)) {
      return fail("claim_not_on_account", "That claim isn't on this patient's account. Use a claim_id from get_statement.");
    }
    return {
      ok: true,
      claims: (args.claim_id ? [args.claim_id] : ids).map((id) => {
        const c = claims[id];
        const status = claimStatus(id);
        return {
          claim_id: id,
          payer: c.payer,
          submitted_on: c.submittedOn,
          processed_on: c.processedOn,
          status,
          denial: c.denial && status === "denied" ? { code: c.denial.code, reason: c.denial.reason } : null,
          agent_can_fix: status === "denied" ? (c.denial?.agentCanFix ?? false) : c.review ? false : null,
          next_step:
            status === "resubmission_pending"
              ? "Already resubmitted with the updated insurance; the balance is on hold. Nothing else is needed from the patient right now."
              : status === "denied"
                ? c.denial?.nextStep
                : (c.review?.nextStep ?? "Claim paid normally. The balance reflects the plan's benefits."),
        };
      }),
    };
  },
});

const sendPaymentLink = defineTool({
  name: "send_payment_link",
  description:
    "Text or email a secure payment link to the contact info on file. Never collect card numbers on the call; always use this instead.",
  schema: z.object({
    verification_token: tokenField,
    amount: z.number().positive().optional().describe("Amount in dollars. Defaults to the full amount due now."),
    channel: z.enum(["sms", "email"]).default("sms"),
  }),
  handler: (args, ctx) => {
    const patient = requirePatient(args.verification_token, ctx);
    if (isFailure(patient)) return patient;
    const s = accountSummary(patient, ctx.now);
    if (s.dueNow <= 0) {
      return fail(
        "nothing_due",
        s.onHold > 0
          ? "The balance is on hold, so no payment is needed right now. Tell the caller they'll get an updated statement."
          : "Nothing is owed. Reassure the caller.",
      );
    }
    const amount = round2(args.amount ?? s.dueNow);
    if (amount > s.dueNow) {
      return fail("amount_exceeds_balance", `The most they can pay right now is ${usd(s.dueNow)}.`);
    }
    const destination = args.channel === "sms" ? maskPhone(patient.phone) : maskEmail(patient.email);
    const link = {
      id: nextId("PAY"),
      patientId: patient.id,
      amount,
      channel: args.channel,
      destinationMasked: destination,
      url: `https://pay.harbor-ortho.example/p/${Math.random().toString(36).slice(2, 10)}`,
      createdAt: ctx.now.toISOString(),
      callId: ctx.callId,
    };
    store.paymentLinks.push(link);
    return {
      ok: true,
      payment_link_id: link.id,
      amount,
      sent_to: destination,
      expires_in_hours: 72,
      remaining_after_payment: round2(s.dueNow - amount),
      agent_guidance: `Tell the caller the link for ${usd(amount)} was sent to ${destination} and is secure. Read back only the masked destination. If that contact is wrong, they need to update it with the front desk; you can't send to a new number.`,
    };
  },
});

const createPaymentPlan = defineTool({
  name: "create_payment_plan",
  description: `Set up a payment plan within Harbor's policy. Installments: balance at least ${usd(PLAN_POLICY.minBalanceForInstallments)}, up to ${PLAN_POLICY.maxAutoApprovedMonths} months automatically or up to ${PLAN_POLICY.maxHardshipMonths} months for financial hardship (needs billing-team approval), minimum ${usd(PLAN_POLICY.minMonthlyPayment)}/month. Balances under ${usd(PLAN_POLICY.minBalanceForInstallments)}: one deferred due date up to ${PLAN_POLICY.maxDeferralDays} days out.`,
  schema: z.object({
    verification_token: tokenField,
    type: z.enum(["installments", "deferred"]),
    months: z.number().int().min(2).max(12).optional().describe("Number of monthly installments (installments only)."),
    hardship_reason: z
      .string()
      .min(10)
      .optional()
      .describe(
        "Only if the caller themselves described financial difficulty: their reason, in their words (e.g. 'lost my job last month'). Leave out otherwise. Wanting lower payments is not hardship.",
      ),
    deferred_due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("YYYY-MM-DD, deferred only."),
  }),
  handler: (args, ctx) => {
    const patient = requirePatient(args.verification_token, ctx);
    if (isFailure(patient)) return patient;
    const s = accountSummary(patient, ctx.now);
    if (s.plan?.status === "active") {
      return fail("plan_exists", `There's already an active plan (${s.plan.id}). Don't create another.`);
    }
    // A plan still waiting for approval can be swapped (e.g. caller asked for 12
    // months, then settled on 6): withdraw it and its approval ticket.
    let replaced: string | undefined;
    if (s.plan?.status === "pending_approval") {
      const old = s.plan;
      store.paymentPlans = store.paymentPlans.filter((p) => p.id !== old.id);
      store.tickets = store.tickets.filter((t) => !(t.category === "payment_plan_approval" && t.summary.includes(old.id)));
      replaced = old.id;
    }
    if (s.dueNow <= 0) return fail("nothing_due", "There's no balance due right now, so no plan is needed.");
    const balance = s.dueNow;

    if (args.type === "deferred") {
      if (balance >= PLAN_POLICY.minBalanceForInstallments) {
        return fail("use_installments", `Balances of ${usd(PLAN_POLICY.minBalanceForInstallments)} or more use installments instead of deferral.`);
      }
      const latest = isoDate(addDays(ctx.now, PLAN_POLICY.maxDeferralDays));
      const due = args.deferred_due_date;
      if (!due || due <= isoDate(ctx.now) || due > latest) {
        return fail("invalid_deferral_date", `Pick a due date after today and no later than ${latest}.`);
      }
      const plan = {
        id: nextId("PLN"),
        patientId: patient.id,
        type: "deferred" as const,
        status: "active" as const,
        total: balance,
        months: 1,
        hardship: false,
        schedule: [{ dueDate: due, amount: balance }],
        createdAt: ctx.now.toISOString(),
        callId: ctx.callId,
      };
      store.paymentPlans.push(plan);
      return { ok: true, plan_id: plan.id, status: plan.status, schedule: plan.schedule, agent_guidance: `Confirm: ${usd(balance)} is now due ${due}.` };
    }

    // installments
    if (balance < PLAN_POLICY.minBalanceForInstallments) {
      return fail(
        "below_plan_minimum",
        `Installments need a balance of at least ${usd(PLAN_POLICY.minBalanceForInstallments)}. Offer to pay in full now or a single deferred due date within ${PLAN_POLICY.maxDeferralDays} days.`,
      );
    }
    const months = args.months;
    if (!months) return fail("months_required", "Ask how many months the caller would like.");
    const maxByMinimum = Math.floor(balance / PLAN_POLICY.minMonthlyPayment);
    if (months > maxByMinimum) {
      return fail("below_minimum_payment", `That would be under ${usd(PLAN_POLICY.minMonthlyPayment)}/month. The most months possible is ${maxByMinimum}.`, {
        max_months: maxByMinimum,
      });
    }
    const hardship = Boolean(args.hardship_reason);
    if (months > PLAN_POLICY.maxAutoApprovedMonths && !hardship) {
      return fail(
        "needs_hardship",
        `Plans longer than ${PLAN_POLICY.maxAutoApprovedMonths} months are only for financial hardship. Offer ${PLAN_POLICY.maxAutoApprovedMonths} months (${usd(installmentSchedule(balance, PLAN_POLICY.maxAutoApprovedMonths, ctx.now)[0].amount)}/month), or gently ask whether paying this off is a financial strain right now. Only if they say it is, try again with hardship_reason in their words.`,
      );
    }
    const schedule = installmentSchedule(balance, months, ctx.now);
    const base = schedule[0].amount;
    const needsApproval = months > PLAN_POLICY.maxAutoApprovedMonths;
    const plan = {
      id: nextId("PLN"),
      patientId: patient.id,
      type: "installments" as const,
      status: needsApproval ? ("pending_approval" as const) : ("active" as const),
      total: balance,
      months,
      hardship,
      schedule,
      createdAt: ctx.now.toISOString(),
      callId: ctx.callId,
    };
    store.paymentPlans.push(plan);
    let approvalTicket: string | undefined;
    if (needsApproval) {
      approvalTicket = nextId("TKT");
      store.tickets.push({
        id: approvalTicket,
        patientId: patient.id,
        category: "payment_plan_approval",
        priority: "normal",
        summary: `Hardship plan requested: ${usd(balance)} over ${months} months (${usd(base)}/month). Plan ${plan.id}. Caller's reason: "${args.hardship_reason}"`,
        createdAt: ctx.now.toISOString(),
        callId: ctx.callId,
      });
    }
    return {
      ok: true,
      plan_id: plan.id,
      status: plan.status,
      monthly_amount: base,
      months,
      first_payment_date: schedule[0].dueDate,
      replaced_pending_plan: replaced,
      approval_ticket_id: approvalTicket,
      agent_guidance: needsApproval
        ? `Tell the caller the ${months}-month plan has been requested and the billing team will confirm within 2 business days. Collections are paused meanwhile. Don't say it's approved.`
        : `Confirm: ${months} payments of about ${usd(base)}, first on ${schedule[0].dueDate}. Offer to text a link to set up autopay.`,
    };
  },
});

const updateInsurance = defineTool({
  name: "update_insurance",
  description:
    "Capture new or additional insurance for a claim that was denied for a fixable reason (e.g. coordination of benefits), and send it for resubmission. Only works when get_claim_status says agent_can_fix is true.",
  schema: z.object({
    verification_token: tokenField,
    claim_id: z.string(),
    payer: z.string().min(2).describe("Insurance company name, e.g. Aetna."),
    member_id: z.string().min(3),
    group_number: z.string().optional(),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Coverage start date, YYYY-MM-DD."),
    coverage_order: z.enum(["primary", "secondary"]).default("primary"),
  }),
  handler: (args, ctx) => {
    const patient = requirePatient(args.verification_token, ctx);
    if (isFailure(patient)) return patient;
    const claim = claims[args.claim_id];
    const onAccount = patient.statement.lines.some((l) => l.claimId === args.claim_id);
    if (!claim || !onAccount) return fail("claim_not_on_account", "Use a claim_id from get_statement.");
    if (claimStatus(args.claim_id) !== "denied" || !claim.denial?.agentCanFix) {
      return fail("not_fixable_by_agent", "This claim can't be fixed by updating insurance. Create a ticket for the billing team instead.");
    }
    const serviceDates = patient.statement.lines.filter((l) => l.claimId === args.claim_id).map((l) => l.serviceDate);
    if (serviceDates.some((d) => d < args.effective_date)) {
      return fail(
        "coverage_starts_after_service",
        `The service date (${serviceDates[0]}) is before this coverage started, so it wouldn't cover the visit. Double-check the start date; if it's right, create a billing_dispute ticket.`,
      );
    }
    const amount = round2(
      patient.statement.lines.filter((l) => l.claimId === args.claim_id).reduce((s, l) => s + l.patientResponsibility, 0),
    );
    const update = {
      id: nextId("INS"),
      patientId: patient.id,
      claimId: args.claim_id,
      payer: args.payer,
      memberId: args.member_id,
      groupNumber: args.group_number,
      effectiveDate: args.effective_date,
      coverageOrder: args.coverage_order,
      createdAt: ctx.now.toISOString(),
      callId: ctx.callId,
    };
    store.insuranceUpdates.push(update);
    store.claimStatusOverrides[args.claim_id] = "resubmission_pending";
    const until = isoDate(addDays(ctx.now, HOLD_DAYS.insuranceResubmission));
    store.holds.push({ patientId: patient.id, claimId: args.claim_id, amount, until, reason: "insurance_resubmission" });
    return {
      ok: true,
      update_id: update.id,
      claim_status: "resubmission_pending",
      amount_on_hold: amount,
      hold_until: until,
      agent_guidance: `Tell the caller the claim will be resubmitted to ${args.payer}, and the ${usd(amount)} is on hold until ${until}, so they don't need to pay it now. They'll get an updated statement once ${args.payer} processes it. Don't promise ${args.payer} will pay.`,
    };
  },
});

const ticketCategories = [
  "billing_dispute",
  "out_of_network_review",
  "hardship_review",
  "payment_plan_approval",
  "insurance_update",
  "verification_failed",
  "callback_request",
  "other",
] as const satisfies readonly TicketCategory[];

const createTicket = defineTool({
  name: "create_ticket",
  description:
    "Hand something to the billing team with a complete summary, so the patient never has to repeat themselves. Use for disputes, out-of-network reviews, hardship, failed verification, and callbacks.",
  schema: z.object({
    verification_token: tokenField.optional().describe("Include if the caller is verified."),
    category: z.enum(ticketCategories),
    summary: z
      .string()
      .min(30)
      .describe("What the caller wants, what you already checked, and what they were told. Written for a billing specialist."),
    claim_id: z.string().optional(),
    callback_phone: z.string().optional().describe("Required if the caller isn't verified."),
    priority: z.enum(["normal", "urgent"]).default("normal"),
  }),
  handler: (args, ctx) => {
    let patient: Patient | undefined;
    if (args.verification_token) {
      const p = requirePatient(args.verification_token, ctx);
      if (isFailure(p)) return p;
      patient = p;
    }
    const callback = args.callback_phone?.replace(/\D/g, "");
    if (!patient && (!callback || callback.length < 10)) {
      return fail("callback_phone_required", "Ask for the best number to call back.");
    }
    if (args.claim_id && (!patient || !patient.statement.lines.some((l) => l.claimId === args.claim_id))) {
      return fail("claim_not_on_account", "Leave claim_id empty or use one from get_statement.");
    }
    const ticket = {
      id: nextId("TKT"),
      patientId: patient?.id,
      category: args.category,
      priority: args.priority,
      summary: args.summary,
      claimId: args.claim_id,
      callbackPhone: callback ?? patient?.phone,
      createdAt: ctx.now.toISOString(),
      callId: ctx.callId,
    };
    store.tickets.push(ticket);

    // Disputes and reviews pause collections on the affected claim.
    let hold: { amount: number; until: string } | undefined;
    const pausesCollections = args.category === "out_of_network_review" || args.category === "billing_dispute";
    if (patient && args.claim_id && pausesCollections) {
      const amount = round2(
        patient.statement.lines.filter((l) => l.claimId === args.claim_id).reduce((s, l) => s + l.patientResponsibility, 0),
      );
      const until = isoDate(addDays(ctx.now, HOLD_DAYS.review));
      store.holds.push({ patientId: patient.id, claimId: args.claim_id, amount, until, reason: args.category });
      hold = { amount, until };
    }
    return {
      ok: true,
      ticket_id: ticket.id,
      response_time: args.priority === "urgent" ? "1 business day" : "2 business days",
      hold,
      agent_guidance: `Give the caller the ticket number ${ticket.id} and tell them the billing team will follow up within ${args.priority === "urgent" ? "1 business day" : "2 business days"}.${hold ? ` The ${usd(hold.amount)} is on hold until ${hold.until} while it's reviewed, so they don't need to pay it now.` : ""} Don't promise an outcome.`,
    };
  },
});

const transferToHuman = defineTool({
  name: "transfer_to_human",
  description:
    "Hand the caller to a person on the billing team. Use immediately when the caller asks for a human, and for anything you can't resolve. During business hours this is a warm transfer; after hours it books a callback.",
  schema: z.object({
    verification_token: tokenField.optional(),
    reason: z.enum(["caller_requested", "out_of_scope", "escalation", "agent_unable"]),
    summary: z.string().min(20).describe("Handoff notes for the person taking over."),
    callback_phone: z.string().optional().describe("Needed after hours if the caller isn't verified."),
  }),
  handler: (args, ctx) => {
    let patient: Patient | undefined;
    if (args.verification_token) {
      const p = requirePatient(args.verification_token, ctx);
      if (!isFailure(p)) patient = p;
    }
    const open = isBusinessHours(ctx.now);
    const callback = args.callback_phone?.replace(/\D/g, "") || patient?.phone;
    if (!open && !callback) {
      return fail("callback_phone_required", "The office is closed. Ask for the best number to call back.");
    }
    const ticket = {
      id: nextId("TKT"),
      patientId: patient?.id,
      category: (open ? "human_handoff" : "callback_request") as TicketCategory,
      priority: args.reason === "escalation" ? ("urgent" as const) : ("normal" as const),
      summary: `[${args.reason}] ${args.summary}`,
      callbackPhone: callback,
      createdAt: ctx.now.toISOString(),
      callId: ctx.callId,
    };
    store.tickets.push(ticket);
    return open
      ? {
          ok: true,
          status: "transferring",
          handoff_id: ticket.id,
          estimated_wait_minutes: 3,
          agent_guidance:
            "Tell the caller you're connecting them to the billing team now, and that you've passed along everything so they won't need to repeat it.",
        }
      : {
          ok: true,
          status: "callback_scheduled",
          ticket_id: ticket.id,
          callback_window: "next business day by 12:00 PM Eastern",
          agent_guidance: `The billing office is closed (Mon–Fri, 8 AM–6 PM Eastern). Tell the caller a specialist will call them back the next business day by noon, with everything already noted. Ticket ${ticket.id}.`,
        };
  },
});

// ---------------------------------------------------------------------------

export const tools = {
  verify_patient: verifyPatient,
  get_statement: getStatement,
  get_claim_status: getClaimStatus,
  send_payment_link: sendPaymentLink,
  create_payment_plan: createPaymentPlan,
  update_insurance: updateInsurance,
  create_ticket: createTicket,
  transfer_to_human: transferToHuman,
} as const;

export type ToolName = keyof typeof tools;

export const isToolName = (n: string): n is ToolName => n in tools;

/** Validate input, run the tool, and log the call (with the token redacted). */
export function runTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): ToolResult {
  const started = Date.now();
  const tool = tools[name] as ToolDef<z.ZodType>;
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  const missingToken = !parsed.success && parsed.error.issues.some((i) => i.path[0] === "verification_token");
  const result: ToolResult = parsed.success
    ? tool.handler(parsed.data, ctx)
    : missingToken
      ? fail("caller_not_verified", "Do not share or discuss any account details. Verify the caller with verify_patient first.")
      : fail("invalid_arguments", "Some details were missing or in the wrong format. Ask the caller for them again.", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
      });

  const args = { ...(rawArgs as Record<string, unknown>) };
  if (args.verification_token) args.verification_token = "[redacted]";
  store.toolCalls.push({
    id: `LOG-${store.toolCalls.length + 1}`,
    at: ctx.now.toISOString(),
    callId: ctx.callId,
    tool: name,
    args,
    ok: result.ok,
    error: result.ok ? undefined : String(result.error),
    audit: result._audit as Record<string, unknown> | undefined,
    durationMs: Date.now() - started,
  });
  // Audit-only details never reach the agent.
  const { _audit: _hidden, ...forAgent } = result;
  void _hidden;
  return forAgent as ToolResult;
}

/** JSON Schema for each tool — used to register the tools with Retell in step 3. */
export function toolDefinitions() {
  return Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.schema as z.ZodType, { io: "input" }),
  }));
}
