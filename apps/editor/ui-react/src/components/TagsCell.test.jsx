import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TagsCell } from "./TagsCell.jsx";

const tags = [
  { id: 1, name: "silver" },
  { id: 2, name: "proof" },
  { id: 3, name: "rare" },
];

function renderTagsCell() {
  return render(
    <TagsCell
      onApplyFilter={vi.fn()}
      tagPlan={{ visibleTags: tags.slice(0, 1), hiddenTags: tags.slice(1) }}
      tags={tags}
    />,
  );
}

function popover() {
  return document.querySelector(".tag-popover");
}

function advance(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the +N tags chip", () => {
  test("hovering it opens the popover and leaving closes it", () => {
    renderTagsCell();

    const more = screen.getByRole("button", { name: "2 more tags" });

    fireEvent.mouseEnter(more);
    // The chip waits out the pointer before it commits to opening.
    expect(popover()).toBeNull();

    advance(300);
    expect(popover()).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "proof" }),
    ).toBeInTheDocument();

    fireEvent.mouseLeave(more);
    advance(150);

    expect(popover()).toBeNull();
  });

  test("keyboard focus opens it at once and blur closes it", () => {
    renderTagsCell();

    const more = screen.getByRole("button", { name: "2 more tags" });

    fireEvent.focus(more);
    expect(popover()).not.toBeNull();

    fireEvent.blur(more);
    advance(150);

    expect(popover()).toBeNull();
  });

  test("a chip inside the popover applies a filter and closes it", () => {
    const onApplyFilter = vi.fn();
    render(
      <TagsCell
        onApplyFilter={onApplyFilter}
        tagPlan={{ visibleTags: tags.slice(0, 1), hiddenTags: tags.slice(1) }}
        tags={tags}
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: "2 more tags" }));
    fireEvent.click(screen.getByRole("button", { name: "rare" }));

    expect(onApplyFilter).toHaveBeenCalledWith("rare", { replace: false });
    expect(popover()).toBeNull();
  });
});
