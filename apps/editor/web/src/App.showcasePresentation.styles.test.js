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

  test("the empty box middle-centers its copy and action", () => {
    const box = styles.match(/\n\.showcase-empty-box\s*\{([^}]*)\}/);
    expect(box).not.toBeNull();
    expect(box[1]).toMatch(/display:\s*flex/);
    expect(box[1]).toMatch(/flex-direction:\s*column/);
    expect(box[1]).toMatch(/align-items:\s*center/);
    expect(box[1]).toMatch(/justify-content:\s*center/);
    expect(box[1]).toMatch(/gap:\s*\d/);
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

describe("showcase note/grouping card heights", () => {
  test("grouping shares the note card's padding and alignment", () => {
    const note = styles.match(/\n\.showcase-card--note\s*\{([^}]*)\}/);
    const grouping = styles.match(/\n\.showcase-card--grouping\s*\{([^}]*)\}/);
    expect(note).not.toBeNull();
    expect(grouping).not.toBeNull();
    for (const prop of [
      /justify-content:\s*flex-start/,
      /gap:\s*8px/,
      /padding:\s*10px/,
    ]) {
      expect(note[1]).toMatch(prop);
      expect(grouping[1]).toMatch(prop);
    }
  });

  test("grouping footer shares the caption's line metrics", () => {
    const caption = styles.match(/\n\.showcase-card-caption\s*\{([^}]*)\}/);
    const name = styles.match(
      /\n\.showcase-card--grouping \.showcase-card-name\s*\{([^}]*)\}/,
    );
    expect(caption).not.toBeNull();
    expect(name).not.toBeNull();
    for (const prop of [
      /font-size:\s*0\.85rem/,
      /line-height:\s*1\.4/,
      /min-height:\s*1\.4em/,
    ]) {
      expect(caption[1]).toMatch(prop);
      expect(name[1]).toMatch(prop);
    }
  });

  test("grouping stays distinguishable without changing size", () => {
    const grouping = styles.match(/\n\.showcase-card--grouping\s*\{([^}]*)\}/);
    const name = styles.match(
      /\n\.showcase-card--grouping \.showcase-card-name\s*\{([^}]*)\}/,
    );
    const icon = styles.match(/\n\.showcase-card-name-icon\s*\{([^}]*)\}/);
    const image = styles.match(/\n\.showcase-card-image\s*\{([^}]*)\}/);
    expect(grouping).not.toBeNull();
    expect(grouping[1]).toMatch(/background:\s*var\(--surface\)/);
    expect(grouping[1]).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--accent\)/);
    expect(name).not.toBeNull();
    expect(name[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(icon).not.toBeNull();
    expect(icon[1]).toMatch(/width:\s*1em/);
    expect(icon[1]).toMatch(/height:\s*1em/);
    // The image well is transparent so letterboxed photos blend into the
    // card instead of adding a third background tone.
    expect(image).not.toBeNull();
    expect(image[1]).toMatch(/background:\s*transparent/);
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
