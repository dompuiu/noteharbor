import { describe, expect, test } from "vitest";
import { computeFilterChipPlan } from "./tableFilterChips.js";

function unit(value, overrides = {}) {
  return {
    condition: { id: value, negated: false, value },
    field: "grading_company",
    groupIndex: 0,
    index: 0,
    label: "Company",
    ...overrides,
  };
}

describe("computeFilterChipPlan", () => {
  test("keeps every unit when the line has room or no width is known", () => {
    expect(computeFilterChipPlan([unit("PMG")], 800)).toEqual({
      hiddenCount: 0,
      visibleCount: 1,
    });
    expect(computeFilterChipPlan([unit("A"), unit("B")], null)).toEqual({
      hiddenCount: 0,
      visibleCount: 2,
    });
  });

  test("gives the units that do not fit to the count chip", () => {
    const units = [
      unit("PMG"),
      unit("PCGS", { index: 1 }),
      unit("TQG", { index: 2 }),
      unit("NGC", { index: 3 }),
    ];
    const plan = computeFilterChipPlan(units, 220);

    expect(plan.visibleCount).toBeGreaterThanOrEqual(1);
    expect(plan.visibleCount).toBeLessThan(units.length);
    expect(plan.visibleCount + plan.hiddenCount).toBe(units.length);
  });

  test("always keeps one chip on the line, even when it is wider than the budget", () => {
    const plan = computeFilterChipPlan([unit("A")], 40);

    expect(plan).toEqual({ hiddenCount: 0, visibleCount: 1 });
  });

  test("adds the AND connector's cost to a new field group", () => {
    const group = [
      unit("PMG"),
      unit("PCGS", { groupIndex: 1, index: 0 }),
    ];

    expect(computeFilterChipPlan(group, 600).hiddenCount).toBe(0);
  });
});
