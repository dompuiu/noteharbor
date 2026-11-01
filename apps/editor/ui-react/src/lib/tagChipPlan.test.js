import { beforeEach, describe, expect, test, vi } from "vitest";
import { computeVisibleTagPlan } from "./tagChipPlan.js";

// jsdom has no canvas backend, so the plan's text measure needs a stand-in
// whose widths are predictable (8px per character).
let measureText;

beforeEach(() => {
  measureText = vi.fn((text) => ({ width: String(text).length * 8 }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText,
  });
});

describe("tag chip plan", () => {
  const tags = [{ name: "aaa" }, { name: "bbbb" }, { name: "cc" }];

  test("a wide column shows every chip", () => {
    const plan = computeVisibleTagPlan(tags, 10000);

    expect(plan.visibleTags).toEqual(tags);
    expect(plan.hiddenTags).toEqual([]);
  });

  test("a medium column keeps what fits and counts the rest", () => {
    const plan = computeVisibleTagPlan(tags, 80);

    expect(plan.visibleTags.map((tag) => tag.name)).toEqual(["aaa"]);
    expect(plan.hiddenTags.map((tag) => tag.name)).toEqual(["bbbb", "cc"]);
  });

  test("a narrow column keeps the +N counter even with no chip shown", () => {
    const plan = computeVisibleTagPlan(tags, 10);

    expect(plan.visibleTags).toEqual([]);
    expect(plan.hiddenTags).toEqual(tags);
  });

  test("repeated names reuse the cached measurement", () => {
    const first = [{ name: "cache-alpha" }, { name: "cache-beta" }];
    computeVisibleTagPlan(first, 10000);
    const callsAfterFirst = measureText.mock.calls.length;

    computeVisibleTagPlan(first, 10000);
    expect(measureText.mock.calls.length).toBe(callsAfterFirst);
  });

});
