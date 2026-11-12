// Synthetic patients for Harbor Orthopedics. Every name, number and account is fictional.
// Phone numbers use the reserved 555-01xx range.
//
// Accounting identity on every line:
//   billed - adjustment - insurancePaid = patientResponsibility
// (checked by tests/data.test.ts)

import type { Claim, Patient, StatementLine } from "./types";

const STATEMENT_DATE = "2026-10-20";
const DUE_DATE = "2026-11-19";

// Reusable line builders
const ptVisit = (date: string, claimId: string, coinsurance?: number): StatementLine => {
  const allowed = 150;
  const patient = coinsurance === undefined ? allowed : (allowed * coinsurance) / 100;
  return {
    serviceDate: date,
    description: "Physical therapy, therapeutic exercise",
    cpt: "97110",
    provider: "Jordan Lee, DPT",
    location: "Harbor Orthopedics – Brooklyn",
    billed: 220,
    allowed,
    insurancePaid: allowed - patient,
    adjustment: 70,
    patientResponsibility: patient,
    responsibilityType: coinsurance === undefined ? "deductible" : "coinsurance",
    claimId,
  };
};

export const claims: Record<string, Claim> = {
  "CLM-A1": { id: "CLM-A1", payer: "UnitedHealthcare", submittedOn: "2026-09-23", processedOn: "2026-10-06", status: "paid" },
  "CLM-B1": { id: "CLM-B1", payer: "Aetna", submittedOn: "2026-10-01", processedOn: "2026-10-12", status: "paid" },
  "CLM-B2": { id: "CLM-B2", payer: "Aetna", submittedOn: "2026-10-15", processedOn: "2026-10-17", status: "paid" },
  "CLM-C1": {
    id: "CLM-C1",
    payer: "UnitedHealthcare",
    submittedOn: "2026-08-15",
    processedOn: "2026-09-05",
    status: "denied",
    denial: {
      code: "CO-22",
      reason:
        "The insurance on file says another plan should pay first (coordination of benefits). This usually means the patient has newer or additional coverage we don't have on file.",
      agentCanFix: true,
      nextStep:
        "Ask whether the patient has new or additional insurance (e.g. a new employer plan). If yes, capture it with update_insurance; the claim is resubmitted and the balance is put on hold for 45 days.",
    },
  },
  "CLM-D1": {
    id: "CLM-D1",
    payer: "Oscar Health",
    submittedOn: "2026-09-11",
    processedOn: "2026-09-29",
    status: "paid",
    review: {
      agentCanFix: false,
      nextStep:
        "Processed out-of-network. Whether the patient is protected from this balance (e.g. under the No Surprises Act, or because network status was misstated at scheduling) needs review by the billing team. Do not explain it away or promise an outcome: create an out_of_network_review ticket and tell the patient the balance is on hold while it's reviewed.",
    },
  },
  "CLM-E1": { id: "CLM-E1", payer: "Cigna", submittedOn: "2026-10-01", processedOn: "2026-10-14", status: "paid" },
  "CLM-F1": { id: "CLM-F1", payer: "Empire BlueCross BlueShield", submittedOn: "2026-08-13", processedOn: "2026-08-28", status: "paid" },
  "CLM-F2": { id: "CLM-F2", payer: "Empire BlueCross BlueShield", submittedOn: "2026-09-17", processedOn: "2026-09-30", status: "paid" },
  "CLM-G1": { id: "CLM-G1", payer: "UnitedHealthcare", submittedOn: "2026-09-19", processedOn: "2026-10-03", status: "paid" },
  "CLM-I1": { id: "CLM-I1", payer: "Aetna", submittedOn: "2026-10-14", processedOn: "2026-10-16", status: "paid" },
};

export const patients: Patient[] = [
  {
    id: "pat_a",
    firstName: "Daniel",
    lastName: "Reyes",
    dob: "1984-03-14",
    phone: "2125550142",
    email: "daniel.reyes@example.com",
    accountNumber: "HO-104218",
    insurance: {
      payer: "UnitedHealthcare",
      planName: "Choice Plus HDHP",
      memberId: "UHC884120371",
      groupNumber: "71820",
      deductible: { annual: 2000, metBeforeThisClaim: 850 },
      network: "in_network",
    },
    statement: {
      id: "STM-A-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        {
          serviceDate: "2026-09-22",
          description: "MRI, right knee, without contrast",
          cpt: "73721",
          provider: "Harbor Imaging",
          location: "Harbor Orthopedics – Manhattan",
          billed: 2400,
          allowed: 1150,
          insurancePaid: 0,
          adjustment: 1250,
          patientResponsibility: 1150,
          responsibilityType: "deductible",
          claimId: "CLM-A1",
        },
      ],
    },
    payments: [],
    scenario: "A – Deductible surprise on an MRI. Expects an explanation, likely a payment plan.",
  },
  {
    id: "pat_b",
    firstName: "Priya",
    lastName: "Shah",
    dob: "1991-07-02",
    phone: "7185550187",
    email: "priya.shah@example.com",
    accountNumber: "HO-104377",
    insurance: {
      payer: "Aetna",
      planName: "Open Access Managed Choice",
      memberId: "W203948571",
      groupNumber: "0284113",
      deductible: { annual: 1000, metBeforeThisClaim: 1000 },
      coinsurancePct: 20,
      network: "in_network",
    },
    statement: {
      id: "STM-B-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        ptVisit("2026-09-08", "CLM-B1", 20),
        ptVisit("2026-09-11", "CLM-B1", 20),
        ptVisit("2026-09-15", "CLM-B1", 20),
        ptVisit("2026-09-18", "CLM-B1", 20),
        ptVisit("2026-09-29", "CLM-B1", 20),
        ptVisit("2026-10-02", "CLM-B2", 20),
        ptVisit("2026-10-06", "CLM-B2", 20),
        ptVisit("2026-10-09", "CLM-B2", 20),
      ],
    },
    payments: [],
    scenario: "B – 20% physical therapy coinsurance across 8 visits ($30 each).",
  },
  {
    id: "pat_c",
    firstName: "Marcus",
    lastName: "Bell",
    dob: "1978-11-30",
    phone: "6465550119",
    email: "marcus.bell@example.com",
    accountNumber: "HO-103952",
    insurance: {
      payer: "UnitedHealthcare",
      planName: "Choice Plus PPO",
      memberId: "UHC551907214",
      groupNumber: "60331",
      network: "in_network",
    },
    statement: {
      id: "STM-C-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-08-14", description: "Office visit, established patient (moderate)", cpt: "99214", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Manhattan", billed: 285, allowed: 0, insurancePaid: 0, adjustment: 0, patientResponsibility: 285, responsibilityType: "denied_claim", claimId: "CLM-C1" },
        { serviceDate: "2026-08-14", description: "X-ray, left shoulder, 2+ views", cpt: "73030", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Manhattan", billed: 140, allowed: 0, insurancePaid: 0, adjustment: 0, patientResponsibility: 140, responsibilityType: "denied_claim", claimId: "CLM-C1" },
        { serviceDate: "2026-08-14", description: "Joint injection, left shoulder", cpt: "20610", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Manhattan", billed: 260, allowed: 0, insurancePaid: 0, adjustment: 0, patientResponsibility: 260, responsibilityType: "denied_claim", claimId: "CLM-C1" },
      ],
    },
    payments: [],
    scenario: "C – Claim denied CO-22 (coordination of benefits). Started a new employer Aetna plan on 2026-07-01 that we don't have on file.",
  },
  {
    id: "pat_d",
    firstName: "Linda",
    lastName: "Okafor",
    dob: "1969-05-21",
    phone: "9175550163",
    email: "linda.okafor@example.com",
    accountNumber: "HO-104011",
    insurance: {
      payer: "Oscar Health",
      planName: "Oscar EPO Bronze",
      memberId: "OSC2219874",
      groupNumber: "IND",
      coinsurancePct: 50,
      network: "out_of_network",
    },
    statement: {
      id: "STM-D-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-09-10", description: "Knee arthroscopy with meniscectomy", cpt: "29881", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics Surgery Center", billed: 4200, allowed: 2100, insurancePaid: 1050, adjustment: 0, patientResponsibility: 3150, responsibilityType: "out_of_network", claimId: "CLM-D1" },
      ],
    },
    payments: [],
    scenario: "D – Processed out-of-network; patient says she was told Harbor was in network. Needs human review, not an agent fix.",
  },
  {
    id: "pat_e",
    firstName: "James",
    lastName: "Whitfield",
    dob: "1956-02-09",
    phone: "3475550128",
    email: "james.whitfield@example.com",
    accountNumber: "HO-103785",
    insurance: {
      payer: "Cigna",
      planName: "Open Access Plus",
      memberId: "U84417203",
      groupNumber: "3339021",
      deductible: { annual: 1500, metBeforeThisClaim: 1220 },
      network: "in_network",
    },
    statement: {
      id: "STM-E-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-09-30", description: "Office visit, established patient", cpt: "99213", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Queens", billed: 195, allowed: 130, insurancePaid: 90, adjustment: 65, patientResponsibility: 40, responsibilityType: "copay", claimId: "CLM-E1" },
        { serviceDate: "2026-09-30", description: "Joint injection, right knee", cpt: "20610", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Queens", billed: 420, allowed: 310, insurancePaid: 30, adjustment: 110, patientResponsibility: 280, responsibilityType: "deductible", claimId: "CLM-E1" },
      ],
    },
    payments: [{ date: "2026-11-03", amount: 320, method: "card" }],
    scenario: "E – Paid in full on 2026-11-03, after the statement went out. Current balance is $0.",
  },
  {
    id: "pat_f",
    firstName: "Rosa",
    lastName: "Delgado",
    dob: "1988-12-12",
    phone: "9295550174",
    email: "rosa.delgado@example.com",
    accountNumber: "HO-103866",
    insurance: {
      payer: "Empire BlueCross BlueShield",
      planName: "Pathway HDHP",
      memberId: "YLX908112455",
      groupNumber: "W51772",
      deductible: { annual: 3000, metBeforeThisClaim: 0 },
      network: "in_network",
    },
    statement: {
      id: "STM-F-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-08-05", description: "New patient visit (moderate)", cpt: "99204", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics – Brooklyn", billed: 390, allowed: 260, insurancePaid: 0, adjustment: 130, patientResponsibility: 260, responsibilityType: "deductible", claimId: "CLM-F1" },
        { serviceDate: "2026-08-12", description: "MRI, left shoulder, without contrast", cpt: "73221", provider: "Harbor Imaging", location: "Harbor Orthopedics – Brooklyn", billed: 2600, allowed: 1350, insurancePaid: 0, adjustment: 1250, patientResponsibility: 1350, responsibilityType: "deductible", claimId: "CLM-F1" },
        { serviceDate: "2026-08-26", description: "Joint injection, left shoulder", cpt: "20610", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics – Brooklyn", billed: 420, allowed: 310, insurancePaid: 0, adjustment: 110, patientResponsibility: 310, responsibilityType: "deductible", claimId: "CLM-F1" },
        { serviceDate: "2026-09-02", description: "Physical therapy evaluation", cpt: "97163", provider: "Jordan Lee, DPT", location: "Harbor Orthopedics – Brooklyn", billed: 260, allowed: 180, insurancePaid: 0, adjustment: 80, patientResponsibility: 180, responsibilityType: "deductible", claimId: "CLM-F2" },
        ptVisit("2026-09-09", "CLM-F2"),
        ptVisit("2026-09-16", "CLM-F2"),
      ],
    },
    payments: [],
    scenario: "F – Recently lost her job; $2,400 all toward deductible. Hardship path.",
  },
  {
    id: "pat_g",
    firstName: "Kevin",
    lastName: "Brooks",
    dob: "1975-09-03",
    phone: "2125550196",
    email: "kevin.brooks@example.com",
    accountNumber: "HO-104150",
    insurance: {
      payer: "UnitedHealthcare",
      planName: "Choice Plus PPO",
      memberId: "UHC330918822",
      groupNumber: "60331",
      deductible: { annual: 1500, metBeforeThisClaim: 1002 },
      coinsurancePct: 20,
      network: "in_network",
    },
    statement: {
      id: "STM-G-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-09-18", description: "Office visit, established patient (moderate)", cpt: "99214", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics – Manhattan", billed: 285, allowed: 190, insurancePaid: 152, adjustment: 95, patientResponsibility: 38, responsibilityType: "coinsurance", claimId: "CLM-G1" },
        { serviceDate: "2026-09-18", description: "X-ray, right knee, 3 views", cpt: "73562", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics – Manhattan", billed: 180, allowed: 120, insurancePaid: 96, adjustment: 60, patientResponsibility: 24, responsibilityType: "coinsurance", claimId: "CLM-G1" },
        { serviceDate: "2026-09-18", description: "Knee brace, hinged", cpt: "L1833", provider: "Dr. Samuel Ortiz", location: "Harbor Orthopedics – Manhattan", billed: 650, allowed: 498, insurancePaid: 0, adjustment: 152, patientResponsibility: 498, responsibilityType: "deductible", claimId: "CLM-G1" },
      ],
    },
    payments: [],
    scenario: "G – Angry; demands a supervisor immediately. (Scenario H: his spouse calls about this account and fails verification.)",
  },
  {
    id: "pat_i",
    firstName: "Aisha",
    lastName: "Khan",
    dob: "1999-04-25",
    phone: "6465550151",
    email: "aisha.khan@example.com",
    accountNumber: "HO-104402",
    insurance: {
      payer: "Aetna",
      planName: "Choice POS II",
      memberId: "W771203946",
      groupNumber: "0811920",
      network: "in_network",
    },
    statement: {
      id: "STM-I-1020",
      statementDate: STATEMENT_DATE,
      dueDate: DUE_DATE,
      lines: [
        { serviceDate: "2026-10-06", description: "Office visit, established patient", cpt: "99213", provider: "Dr. Elena Park", location: "Harbor Orthopedics – Manhattan", billed: 195, allowed: 130, insurancePaid: 90, adjustment: 65, patientResponsibility: 40, responsibilityType: "copay", claimId: "CLM-I1" },
        { serviceDate: "2026-10-13", description: "Physical therapy, therapeutic exercise", cpt: "97110", provider: "Jordan Lee, DPT", location: "Harbor Orthopedics – Manhattan", billed: 220, allowed: 150, insurancePaid: 105, adjustment: 70, patientResponsibility: 45, responsibilityType: "copay", claimId: "CLM-I1" },
      ],
    },
    payments: [],
    scenario: "I – $85 in copays; wants to pay now. Fast path.",
  },
];

export const findPatientById = (id: string) => patients.find((p) => p.id === id);
