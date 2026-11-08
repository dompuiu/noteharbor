import { afterEach, describe, expect, test } from "vitest";
import { floatingListLayout } from "./floatingList.js";

function anchor(box) {
  return { getBoundingClientRect: () => box };
}

const originalHeight = window.innerHeight;
const originalWidth = window.innerWidth;

afterEach(() => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalHeight,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
});

function viewport(height, width = 1024) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("floatingListLayout", () => {
  test("opens below the field when the list fits", () => {
    viewport(800);

    const layout = floatingListLayout(
      anchor({ top: 100, bottom: 140, left: 20, width: 200 }),
      100,
    );

    expect(layout.top).toBe(144);
    expect(layout.bottom).toBeUndefined();
    expect(layout.left).toBe(20);
    expect(layout.width).toBe(200);
  });

  // A field near the bottom flips the list above it instead of letting the
  // viewport crop the menu.
  test("flips above a field near the bottom", () => {
    viewport(800);

    const layout = floatingListLayout(
      anchor({ top: 700, bottom: 740, left: 20, width: 200 }),
      200,
    );

    expect(layout.bottom).toBe(104);
    expect(layout.top).toBeUndefined();
    expect(layout.maxHeight).toBe(220);
  });

  test("clamps the height to the space on the chosen side", () => {
    viewport(800);

    const layout = floatingListLayout(
      anchor({ top: 520, bottom: 560, left: 20, width: 200 }),
      200,
    );

    // 800 - 560 - 4 - 8 = 228 below, but the list only wants 200, so it fits.
    expect(layout.top).toBe(564);
    expect(layout.maxHeight).toBe(220);
  });

  test("keeps the list inside the right edge", () => {
    viewport(800, 1024);

    const layout = floatingListLayout(
      anchor({ top: 100, bottom: 140, left: 1000, width: 200 }),
      100,
    );

    expect(layout.left).toBe(816);
  });
});
