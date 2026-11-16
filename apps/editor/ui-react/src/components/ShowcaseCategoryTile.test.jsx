import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";

describe("ShowcaseCategoryTile", () => {
  test("the closed card explains the shared category pool", () => {
    render(<ShowcaseCategoryTile categories={[]} onAdd={vi.fn()} />);

    const card = screen.getByRole("button", { name: "New category" });
    expect(card).toHaveTextContent("New category");
    expect(card).toHaveTextContent(
      "Reuse a category from the pool or type a new name",
    );
  });
});
