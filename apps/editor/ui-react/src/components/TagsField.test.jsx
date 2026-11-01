import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TagsField } from "./TagsField.jsx";

function renderField(props = {}) {
  return render(<TagsField value={["alpha", "beta"]} {...props} />);
}

describe("TagsField chips", () => {
  // The note editor's tags must read as the same chips as the table filter's,
  // so the two places never drift into separate visual languages.
  test("chips reuse the table filter chip and remove affordances", () => {
    const { container } = renderField();

    expect(container.querySelectorAll(".table-filter-chip")).toHaveLength(2);
    expect(container.querySelectorAll(".table-filter-chip-remove")).toHaveLength(
      2,
    );

    const cross = screen.getByRole("button", { name: "Remove alpha" });
    expect(cross).toHaveClass("table-filter-chip-remove");
    expect(cross.querySelector("svg")).not.toBeNull();
  });

  // The filter lets you edit a value in place. The note editor does not: the
  // tag label is text, and only the drawn cross removes it.
  test("the tag value is not an in-place editor", () => {
    renderField();

    expect(screen.queryByRole("button", { name: "alpha" })).toBeNull();
    expect(screen.getByText("alpha")).not.toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByText("alpha")).toHaveClass("table-filter-chip-value");
  });

  test("a chip cross removes exactly that tag", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderField({ onChange });

    await user.click(screen.getByRole("button", { name: "Remove alpha" }));

    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  // Same affordance as the filter row, label and look included.
  test("Clear all reuses the table filter's clear affordance", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderField({ onChange });

    const clear = screen.getByRole("button", { name: "Clear all tags" });
    expect(clear).toHaveClass("table-filter-clear-all");

    await user.click(clear);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  // The filter shows Clear all as soon as one chip is present; the editor
  // follows it instead of waiting for a second tag.
  test("Clear all is offered with a single tag", () => {
    renderField({ value: ["alpha"] });

    expect(
      screen.getByRole("button", { name: "Clear all tags" }),
    ).toBeInTheDocument();
  });
});
