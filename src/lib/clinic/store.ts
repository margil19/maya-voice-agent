// In-memory record of everything Maya changes or does during calls.
// Step 5 (ops dashboard) swaps this for a database; the interface stays the same.

export type PaymentLink = {
  id: string;
  patientId: string;
  amount: number;
  channel: "sms" | "email";
  destinationMasked: string;
  url: string;
  createdAt: string;
  callId?: string;
};

export type PaymentPlan = {
  id: string;
  patientId: string;
  type: "installments" | "deferred";
  status: "active" | "pending_approval";
  total: number;
  months: number;
  hardship: boolean;
  schedule: { dueDate: string; amount: number }[];
  createdAt: string;
  callId?: string;
};

export type TicketCategory =
  | "billing_dispute"
  | "out_of_network_review"
  | "hardship_review"
  | "payment_plan_approval"
  | "insurance_update"
  | "verification_failed"
  | "callback_request"
  | "human_handoff"
  | "other";

export type Ticket = {
  id: string;
  patientId?: string;
  category: TicketCategory;
  priority: "normal" | "urgent";
  summary: string;
  claimId?: string;
  callbackPhone?: string;
  createdAt: string;
  callId?: string;
};

export type InsuranceUpdate = {
  id: string;
  patientId: string;
  claimId: string;
  payer: string;
  memberId: string;
  groupNumber?: string;
  effectiveDate: string;
  coverageOrder: "primary" | "secondary";
  createdAt: string;
  callId?: string;
};

export type Hold = { patientId: string; claimId: string; amount: number; until: string; reason: string };

export type ToolCallLog = {
  id: string;
  at: string;
  callId?: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  audit?: Record<string, unknown>; // internal details never shown to the agent
  durationMs: number;
};

type Store = {
  paymentLinks: PaymentLink[];
  paymentPlans: PaymentPlan[];
  tickets: Ticket[];
  insuranceUpdates: InsuranceUpdate[];
  holds: Hold[];
  claimStatusOverrides: Partial<Record<string, "resubmission_pending">>;
  verificationFailures: Record<string, number>; // keyed by call id
  toolCalls: ToolCallLog[];
  counter: number;
};

const empty = (): Store => ({
  paymentLinks: [],
  paymentPlans: [],
  tickets: [],
  insuranceUpdates: [],
  holds: [],
  claimStatusOverrides: {},
  verificationFailures: {},
  toolCalls: [],
  counter: 0,
});

// Survive Next.js hot reloads in dev.
const g = globalThis as unknown as { __harborStore?: Store };
export const store: Store = (g.__harborStore ??= empty());

export function resetStore() {
  Object.assign(store, empty());
}

export function nextId(prefix: string) {
  store.counter += 1;
  return `${prefix}-${String(store.counter).padStart(5, "0")}`;
}
