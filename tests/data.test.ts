// The synthetic data has to be internally consistent, or Maya will "explain"
// numbers that don't add up — exactly the accuracy failure we score her on.

import { describe, expect, it } from "vitest";
import { claims, patients } from "@/lib/clinic/data";

describe("synthetic data integrity", () => {
  for (const p of patients) {
    describe(`${p.firstName} ${p.lastName}`, () => {
      it("every line satisfies billed - adjustment - insurance paid = patient owes", () => {
        for (const l of p.statement.lines) {
          expect(l.billed - l.adjustment - l.insurancePaid).toBeCloseTo(l.patientResponsibility, 2);
        }
      });

      it("every line points at a known claim", () => {
        for (const l of p.statement.lines) expect(claims[l.claimId]).toBeDefined();
      });

      it("deductible charges never exceed the remaining deductible", () => {
        const d = p.insurance.deductible;
        if (!d) return;
        const applied = p.statement.lines
          .filter((l) => l.responsibilityType === "deductible")
          .reduce((s, l) => s + l.patientResponsibility, 0);
        expect(applied).toBeLessThanOrEqual(d.annual - d.metBeforeThisClaim);
      });
    });
  }

  it("matches the balances in the spec", () => {
    const balance = (id: string) => {
      const p = patients.find((x) => x.id === id)!;
      const charges = p.statement.lines.reduce((s, l) => s + l.patientResponsibility, 0);
      return charges - p.payments.reduce((s, x) => s + x.amount, 0);
    };
    expect(balance("pat_a")).toBe(1150);
    expect(balance("pat_b")).toBe(240);
    expect(balance("pat_c")).toBe(685);
    expect(balance("pat_d")).toBe(3150);
    expect(balance("pat_e")).toBe(0);
    expect(balance("pat_f")).toBe(2400);
    expect(balance("pat_g")).toBe(560);
    expect(balance("pat_i")).toBe(85);
  });
});
