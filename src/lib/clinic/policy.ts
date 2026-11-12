// Harbor Orthopedics billing policy and account math.

import { claims } from "./data";
import { store } from "./store";
import type { Patient, StatementLine } from "./types";

export const PLAN_POLICY = {
  minBalanceForInstallments: 200,
  maxAutoApprovedMonths: 6,
  maxHardshipMonths: 12,
  minMonthlyPayment: 50,
  maxDeferralDays: 30,
} as const;

export const HOLD_DAYS = { insuranceResubmission: 45, review: 30 } as const;

export const TIME_ZONE = "America/New_York";

// --- money & dates ----------------------------------------------------------

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export function addMonths(d: Date, months: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

// --- business hours ---------------------------------------------------------

/** Billing office: Monday–Friday, 8:00–18:00 Eastern. */
export function isBusinessHours(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday !== "Sat" && weekday !== "Sun" && hour >= 8 && hour < 18;
}

// --- balances ---------------------------------------------------------------

export function accountSummary(patient: Patient, now: Date) {
  const charges = round2(patient.statement.lines.reduce((s, l) => s + l.patientResponsibility, 0));
  const paid = round2(patient.payments.reduce((s, p) => s + p.amount, 0));
  const balance = round2(charges - paid);
  const today = isoDate(now);
  const activeHolds = store.holds.filter((h) => h.patientId === patient.id && h.until >= today);
  const onHold = round2(Math.min(balance, activeHolds.reduce((s, h) => s + h.amount, 0)));
  const plan = store.paymentPlans.find((p) => p.patientId === patient.id);
  return {
    statementCharges: charges,
    paymentsSinceStatement: paid,
    balance,
    onHold,
    dueNow: round2(balance - onHold),
    holds: activeHolds,
    plan,
  };
}

export function claimStatus(claimId: string) {
  const claim = claims[claimId];
  return store.claimStatusOverrides[claimId] ?? claim.status;
}

// --- payment plan math (single source for quotes AND plan creation) --------

/** Equal monthly payments rounded down to the cent; the last one absorbs the remainder. */
export function installmentSchedule(balance: number, months: number, now: Date) {
  const base = Math.floor((balance / months) * 100) / 100;
  return Array.from({ length: months }, (_, i) => ({
    dueDate: isoDate(addMonths(now, i + 1)),
    amount: i === months - 1 ? round2(balance - base * (months - 1)) : base,
  }));
}

/**
 * Standard options Maya may offer, with exact amounts, so she never does math
 * on a call (a real call had her quote "about one ninety-two" for $191.66).
 * Hardship-length plans are deliberately not listed: they're only for callers
 * who say paying is a struggle.
 */
export function standardPaymentOptions(dueNow: number, now: Date) {
  if (dueNow <= 0) return [];
  if (dueNow < PLAN_POLICY.minBalanceForInstallments) {
    return [
      { option: "pay_in_full", amount: dueNow },
      { option: "defer", amount: dueNow, latest_due_date: isoDate(addDays(now, PLAN_POLICY.maxDeferralDays)) },
    ];
  }
  const plans = [3, 6]
    .filter((m) => m <= PLAN_POLICY.maxAutoApprovedMonths && dueNow / m >= PLAN_POLICY.minMonthlyPayment)
    .map((m) => {
      const schedule = installmentSchedule(dueNow, m, now);
      return {
        option: `${m}_month_plan`,
        months: m,
        monthly_amount: schedule[0].amount,
        final_payment: schedule[m - 1].amount,
        first_due: schedule[0].dueDate,
      };
    });
  return [{ option: "pay_in_full", amount: dueNow }, ...plans];
}

// --- plain-language explanation of one statement line ----------------------

export function explainLine(line: StatementLine, patient: Patient): string {
  const parts = [`${line.description} on ${line.serviceDate}: billed ${usd(line.billed)}.`];
  switch (line.responsibilityType) {
    case "denied_claim":
      parts.push(
        `Insurance denied this claim, so the full ${usd(line.patientResponsibility)} moved to the patient. Check get_claim_status for why and whether it can be fixed.`,
      );
      break;
    case "out_of_network":
      parts.push(
        `Processed out-of-network: the plan allowed ${usd(line.allowed)} and paid ${usd(line.insurancePaid)}. Because Harbor has no contract with this plan, the remaining ${usd(line.patientResponsibility)} was billed to the patient.`,
      );
      break;
    default: {
      parts.push(
        `The plan's negotiated rate is ${usd(line.allowed)}, so ${usd(line.adjustment)} was written off and is never owed.`,
      );
      const why =
        line.responsibilityType === "deductible"
          ? `went toward the deductible${
              patient.insurance.deductible
                ? ` (${usd(patient.insurance.deductible.annual)} per year)`
                : ""
            }`
          : line.responsibilityType === "coinsurance"
            ? `is the patient's ${patient.insurance.coinsurancePct ?? ""}% coinsurance share`
            : "is the copay for this visit";
      parts.push(
        `Insurance paid ${usd(line.insurancePaid)}; the remaining ${usd(line.patientResponsibility)} ${why}.`,
      );
    }
  }
  return parts.join(" ");
}
