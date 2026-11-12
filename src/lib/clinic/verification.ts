// Identity verification. Rule 1 of the spec ("identity before account details")
// is enforced here in the backend, not just in Maya's prompt: every tool that
// returns account data requires a signed token that only verify_patient issues.

import { createHmac, timingSafeEqual } from "node:crypto";
import { patients } from "./data";
import type { Patient } from "./types";

const TOKEN_TTL_MS = 60 * 60 * 1000; // one call's worth
export const MAX_VERIFICATION_ATTEMPTS = 3;

function secret() {
  const s = process.env.VERIFICATION_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("VERIFICATION_SECRET must be set in production");
  }
  return s ?? "dev-only-verification-secret";
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueToken(patientId: string, callId: string | undefined, now: Date) {
  const payload = Buffer.from(
    JSON.stringify({ pid: patientId, cid: callId ?? null, exp: now.getTime() + TOKEN_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export type TokenCheck = { ok: true; patientId: string } | { ok: false; reason: string };

export function checkToken(token: string | undefined, callId: string | undefined, now: Date): TokenCheck {
  if (!token) return { ok: false, reason: "missing" };
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    pid: string;
    cid: string | null;
    exp: number;
  };
  if (data.exp < now.getTime()) return { ok: false, reason: "expired" };
  // A token issued on one call can't be replayed on another.
  if (data.cid && callId && data.cid !== callId) return { ok: false, reason: "wrong_call" };
  return { ok: true, patientId: data.pid };
}

// --- matching -------------------------------------------------------------

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// Callers speak numbers ("one zero four", "oh", "double five"), and models
// sometimes pass those words straight through. Normalize before matching.
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};
export function spokenToChars(s: string) {
  return s
    .toLowerCase()
    .replace(/\b(double|triple)\s+(\w+)\b/g, (_, k: string, w: string) => (NUMBER_WORDS[w] ?? w).repeat(k === "double" ? 2 : 3))
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => NUMBER_WORDS[w]);
}
const digits = (s: string) => spokenToChars(s).replace(/\D/g, "");
const alnum = (s: string) => spokenToChars(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

type NameMatch = "exact" | "sounds_alike" | false;

function firstNameMatch(given: string, actual: string): NameMatch {
  const a = letters(given);
  const b = letters(actual);
  if (a === b) return "exact";
  // Common short forms ("Dan" for "Daniel"), but require 3+ letters.
  if (a.length >= 3 && b.startsWith(a)) return "exact";
  // Speech-to-text spells names its own way ("Ayesha" for "Aisha", from a real call).
  return soundex(a) === soundex(b) ? "sounds_alike" : false;
}

function lastNameMatch(given: string, actual: string): NameMatch {
  if (letters(given) === letters(actual)) return "exact";
  // "Reese" for "Reyes", from a real call.
  return soundex(given) === soundex(actual) ? "sounds_alike" : false;
}

/**
 * Account numbers are "HO" + six digits (e.g. HO-104218). The prefix is the part
 * speech recognition mangles: real calls produced "H zero", "H h o" and
 * "Eight zero". So only the six digits are compared; the "O" in the prefix,
 * when heard as "zero", is dropped first.
 */
function accountCore(s: string) {
  const d = alnum(s).replace(/[A-Z]/g, "");
  return d.length > 6 ? d.slice(-6) : d;
}

function accountMatches(given: string, actual: string) {
  const g = accountCore(given);
  return g.length >= 6 && g === accountCore(actual);
}

/** American Soundex: "Reese" and "Reyes" both encode to R200. */
export function soundex(name: string) {
  const s = letters(name).toUpperCase();
  if (!s) return "";
  const code: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3", L: "4", M: "5", N: "5", R: "6",
  };
  let out = s[0];
  let prev = code[s[0]] ?? "";
  for (const ch of s.slice(1)) {
    const c = code[ch] ?? "";
    if (c && c !== prev) out += c;
    // H and W don't separate duplicate codes; vowels do.
    if (ch !== "H" && ch !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

export type VerifyInput = {
  firstName: string;
  lastName: string;
  dob: string;
  accountNumber?: string;
  phone?: string;
};

export type VerifyMatch = { patient: Patient; nameMatch: "exact" | "sounds_alike" };

/**
 * Date of birth and the second factor (account number or phone on file) must match
 * exactly. Because those two strong factors carry the security, the last name may
 * match by sound: speech recognition routinely mishears names ("Reese" for "Reyes").
 */
export function findMatchingPatient(input: VerifyInput): VerifyMatch | undefined {
  for (const p of patients) {
    // The strong factors must match exactly...
    if (input.dob !== p.dob) continue;
    const accountOk = input.accountNumber ? accountMatches(input.accountNumber, p.accountNumber) : false;
    const phoneOk = input.phone ? digits(input.phone).slice(-10) === p.phone : false;
    if (!accountOk && !phoneOk) continue;
    // ...while names, which speech-to-text spells unpredictably, may match by sound.
    const first = firstNameMatch(input.firstName, p.firstName);
    const last = lastNameMatch(input.lastName, p.lastName);
    if (!first || !last) continue;
    return { patient: p, nameMatch: first === "exact" && last === "exact" ? "exact" : "sounds_alike" };
  }
  return undefined;
}

/** Input that is clearly incomplete (not wrong) shouldn't use up a verification attempt. */
export function incompleteInput(input: VerifyInput): string | undefined {
  const phoneDigits = input.phone ? digits(input.phone).length : 0;
  const accountLen = input.accountNumber ? accountCore(input.accountNumber).length : 0;
  if (input.phone && !input.accountNumber && phoneDigits < 10) return `phone has ${phoneDigits} digits`;
  if (input.accountNumber && !input.phone && accountLen < 6) return "account number too short";
  return undefined;
}
