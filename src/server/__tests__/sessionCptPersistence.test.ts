import { describe, expect, it } from "vitest";
import { BILLING_UNIT_MINUTES } from "../cptRules";
import { BILLING_UNIT_CASES } from "../__testUtils__/cptTestVectors";
import { createPseudoRandom } from "../__testUtils__/random";
import { computeBillingMetrics } from "../sessionCptPersistence";

describe("computeBillingMetrics", () => {
  it("returns null minutes and baseline unit when input is invalid", () => {
    expect(computeBillingMetrics(null)).toEqual({ minutes: null, units: 1 });
    expect(computeBillingMetrics(undefined)).toEqual({ minutes: null, units: 1 });
    expect(computeBillingMetrics(-5)).toEqual({ minutes: null, units: 1 });
  });

  it.each(BILLING_UNIT_CASES)(
    "applies eight-minute rule thresholds for $minutes minutes",
    ({ minutes, expectedUnits }) => {
      const { minutes: rounded, units } = computeBillingMetrics(minutes);
      expect(rounded).toBe(Math.max(1, Math.round(minutes)));
      expect(units).toBe(expectedUnits);
    },
  );

  it("rounds before computing units for fractional minutes", () => {
    const { minutes, units } = computeBillingMetrics(52.6);
    expect(minutes).toBe(53);
    expect(units).toBe(4);
  });

  it("matches eight-minute rule expectations across randomized samples", () => {
    const random = createPseudoRandom(1337);
    const iterations = 500;
    for (let i = 0; i < iterations; i += 1) {
      const candidate = random() * 480; // Up to eight hours
      const { minutes, units } = computeBillingMetrics(candidate);
      if (minutes === null) {
        expect(units).toBe(1);
        continue;
      }
      const expectedMinutes = Math.max(1, Math.round(candidate));
      expect(minutes).toBe(expectedMinutes);
      const baseUnits = Math.floor(expectedMinutes / BILLING_UNIT_MINUTES);
      const remainder = expectedMinutes % BILLING_UNIT_MINUTES;
      const expectedUnits = Math.max(1, baseUnits + (remainder >= 8 ? 1 : 0));
      expect(units).toBe(expectedUnits);
    }
  });
});
