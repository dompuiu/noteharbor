import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TagSuggestionCloud } from "./NoteEditForm.jsx";

describe("TagSuggestionCloud", () => {
  // The suggestions sit directly under the tags field, so they are the same
  // chip as the ones the field renders, minus the cross.
  test("suggestions reuse the table filter chip surface", () => {
    render(
      <TagSuggestionCloud
        onSelect={() => {}}
        selected={[]}
        vocabulary={["alpha", "beta"]}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass("table-filter-chip");
      expect(button).not.toHaveClass("tag");
    }
  });

  test("clicking a suggestion adds that tag", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TagSuggestionCloud
        onSelect={onSelect}
        selected={[]}
        vocabulary={["alpha"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "alpha" }));

    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  test("already-selected tags are not suggested", () => {
    render(
      <TagSuggestionCloud
        onSelect={() => {}}
        selected={["alpha"]}
        vocabulary={["alpha", "beta"]}
      />,
    );

    expect(screen.queryByRole("button", { name: "alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "beta" })).toBeInTheDocument();
  });
});
