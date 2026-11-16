import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";

function marks(container) {
  return container.querySelector(".showcase-cell-marks");
}

describe("ShowcaseReorderableCell focus marks", () => {
  test("every cell carries one hidden overlay with four corner marks", () => {
    const { container } = render(
      <ShowcaseReorderableCell label="Pick 22a" nodeId={1} reorder={null}>
        <button type="button">card</button>
      </ShowcaseReorderableCell>,
    );

    const overlay = marks(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay.querySelectorAll(".showcase-cell-mark")).toHaveLength(4);
    // The overlay paints over the card and the footer, so it is the cell's
    // last child rather than something a card can cover.
    expect(container.firstChild.lastElementChild).toBe(overlay);
  });

  test("an embedded cell keeps the same single overlay", () => {
    const { container } = render(
      <ShowcaseReorderableCell
        embedded
        label="Pick 22a"
        nodeId={2}
        reorder={null}
      >
        {() => <div className="showcase-card">card</div>}
      </ShowcaseReorderableCell>,
    );

    expect(container.querySelectorAll(".showcase-cell-marks")).toHaveLength(1);
    expect(marks(container).querySelectorAll(".showcase-cell-mark")).toHaveLength(
      4,
    );
  });
});
