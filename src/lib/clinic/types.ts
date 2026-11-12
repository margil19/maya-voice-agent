// Domain model for the fictional Harbor Orthopedics billing office.
// All data in this project is synthetic.

export type ResponsibilityType =
  | "deductible"
  | "coinsurance"
  | "copay"
  | "denied_claim" // insurance denied, balance moved to patient
  | "out_of_network";

export type Insurance = {
  payer: string;
  planName: string;
  memberId: string;
  groupNumber: string;
  // Deductible state as of the latest processed claim
  deductible?: { annual: number; metBeforeThisClaim: number };
  coinsurancePct?: number;
  network: "in_network" | "out_of_network";
};

export type ClaimStatus = "paid" | "denied" | "resubmission_pending";

export type Claim = {
  id: string;
  payer: string;
  submittedOn: string; // ISO date
  processedOn: string;
  status: ClaimStatus;
  denial?: {
    code: string; // CARC code as it appears on the EOB
    reason: string; // plain-language reason
    agentCanFix: boolean; // can Maya resolve it on the call?
    nextStep: string; // guidance returned to the agent
  };
  // Guidance for paid claims that still need human review (e.g. out-of-network)
  review?: { agentCanFix: false; nextStep: string };
};

export type StatementLine = {
  serviceDate: string;
  description: string;
  cpt: string;
  provider: string;
  location: string;
  billed: number;
  allowed: number; // insurance negotiated rate
  insurancePaid: number;
  adjustment: number; // contractual write-off (billed - allowed) or other
  patientResponsibility: number;
  responsibilityType: ResponsibilityType;
  claimId: string;
};

export type PatientPayment = {
  date: string;
  amount: number;
  method: "card" | "ach" | "check";
};

export type Statement = {
  id: string;
  statementDate: string;
  dueDate: string;
  lines: StatementLine[];
};

export type Patient = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  phone: string; // digits only, 10 digits
  email: string;
  accountNumber: string;
  insurance: Insurance;
  statement: Statement;
  payments: PatientPayment[];
  // Internal notes the billing team would see (never read verbatim to callers)
  scenario: string;
};
