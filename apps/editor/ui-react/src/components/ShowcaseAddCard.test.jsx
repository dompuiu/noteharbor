import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseAddCard } from "./ShowcaseAddCard.jsx";

describe("ShowcaseAddCard", () => {
  test("offers the level's three add modes in one quiet card", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ShowcaseAddCard onAdd={onAdd} />);

    const card = screen.getByRole("button", { name: "Add to this level" });
    expect(card).toHaveTextContent("Add to this level");
    expect(card).toHaveTextContent("Note · Catalog shell · Grouping");

    await user.click(card);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
