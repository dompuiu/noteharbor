import { describe, expect, test } from "vitest";
import {
  computeFilterChipLayout,
  computeFilterChipPlan,
} from "./tableFilterChips.js";

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

describe("computeFilterChipLayout", () => {
  test("keeps the chips on the field's line when they fit beside it", () => {
    // 1160 card: 1140 inside, minus a 400px field, 260px of controls and the
    // two 12px gaps, leaves 456px for the chips.
    expect(
      computeFilterChipLayout({ actionsWidth: 260, railWidth: 1160 }),
    ).toEqual({ availableWidth: 456, ownLine: false });
  });

  test("gives the chips their own line when the field's line cannot hold them", () => {
    // 900 card: 880 inside, minus the 400px field, 380px of controls and the
    // gaps, leaves 76px — not enough for one chip, so the line wraps and the
    // plan gets the full 880px.
    expect(
      computeFilterChipLayout({ actionsWidth: 380, railWidth: 900 }),
    ).toEqual({ availableWidth: 880, ownLine: true });
  });

  test("takes its own line before the controls have been measured", () => {
    // An unmeasured cluster cannot vouch for the inline gap; the full line is
    // always safe and the controls are measured on the next frame.
    expect(computeFilterChipLayout({ actionsWidth: null, railWidth: 1160 })).toEqual(
      { availableWidth: 1140, ownLine: true },
    );
  });

  test("plans nothing against an unknown rail", () => {
    expect(computeFilterChipLayout({ actionsWidth: 200, railWidth: null })).toEqual(
      { availableWidth: null, ownLine: false },
    );
  });
});
