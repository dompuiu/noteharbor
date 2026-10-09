import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot evaluate `prefers-reduced-motion`, so the note card's swap
// motion is pinned here over the stylesheet source: the two faces cross-fade,
// and the reduced-motion block drops that transition (presentation spec §8).
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("showcase note-card motion", () => {
  test("the front and back faces cross-fade", () => {
    const face = styles.match(/\n\.showcase-card-face\s*\{([^}]*)\}/);
    expect(face).not.toBeNull();
    expect(face[1]).toMatch(/transition:\s*opacity/);
  });

  test("reduced motion stops the swap cross-fade", () => {
    const block = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(
      /\.showcase-card-face\s*\{[^}]*transition:\s*none/,
    );
  });
});
