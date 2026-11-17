import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";

describe("ShowcaseCategoryTile", () => {
  test("the closed card explains the shared category pool", () => {
    render(<ShowcaseCategoryTile onOpen={vi.fn()} />);

    const card = screen.getByRole("button", { name: "New category" });
    expect(card).toHaveTextContent("New category");
    expect(card).toHaveTextContent(
      "Reuse a category from the pool or type a new name",
    );
  });

  test("delegates opening instead of rendering an inline form", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ShowcaseCategoryTile onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "New category" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Category name")).not.toBeInTheDocument();
  });
});
