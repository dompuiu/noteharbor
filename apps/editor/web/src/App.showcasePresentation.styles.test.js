import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot evaluate `prefers-reduced-motion`, so the note card's swap
// motion is pinned here over the stylesheet source: the two faces cross-fade,
// and the reduced-motion block drops that transition (presentation spec §8).
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("showcase empty-state styles", () => {
  test("the empty box is a dashed container with centered copy", () => {
    const box = styles.match(/\n\.showcase-empty-box\s*\{([^}]*)\}/);
    expect(box).not.toBeNull();
    expect(box[1]).toMatch(/border:\s*2px\s+dashed/);
    expect(box[1]).toMatch(/text-align:\s*center/);
  });

  test("the create tiles use a dashed border with the accent label", () => {
    const tile = styles.match(/\n\.showcase-tile\s*\{([^}]*)\}/);
    expect(tile).not.toBeNull();
    expect(tile[1]).toMatch(/border:\s*2px\s+dashed/);
    expect(tile[1]).toMatch(/color:\s*var\(--accent-strong\)/);
  });

  test("the centered tile matches the prototype button width", () => {
    const centered = styles.match(
      /\n\.showcase-tile--centered\s*\{([^}]*)\}/,
    );
    expect(centered).not.toBeNull();
    expect(centered[1]).toMatch(/max-width:\s*320px/);
    expect(centered[1]).toMatch(/margin:\s*0\s+auto/);
  });
});

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
