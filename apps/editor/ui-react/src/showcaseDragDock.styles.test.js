import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot place a fixed element over a scrolling canvas, so the drag
// dock's contract is pinned over the stylesheet source: it floats, it never
// joins the flow, and only its chips take the pointer.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

function rule(selector) {
  const start = styles.indexOf(`${selector} {`);

  if (start < 0) {
    return "";
  }

  let depth = 0;

  for (let index = styles.indexOf("{", start); index < styles.length; index += 1) {
    if (styles[index] === "{") {
      depth += 1;
    } else if (styles[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return styles.slice(start, index + 1);
      }
    }
  }

  return "";
}

describe("showcase drag dock", () => {
  test("floats over the canvas instead of reserving a band in the flow", () => {
    const dock = rule(".showcase-drag-dock");

    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).not.toMatch(/(^|\n)\s*margin(-bottom)?:/);
    expect(styles).not.toMatch(/\.showcase-drag-bar\s*\{/);
  });

  test("lets the pointer through the text but not the level chips", () => {
    expect(rule(".showcase-drag-dock")).toMatch(/pointer-events:\s*none/);
    expect(rule(".showcase-drag-levels")).toMatch(/pointer-events:\s*auto/);
  });

  test("the drawer bridges the gap under its card", () => {
    const bridge = rule(".showcase-spring-drawer::before");

    expect(bridge).toMatch(/bottom:\s*100%/);
    expect(bridge).toMatch(/height:\s*8px/);
  });
});
