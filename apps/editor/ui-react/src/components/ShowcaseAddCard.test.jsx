import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseAddCard } from "./ShowcaseAddCard.jsx";

describe("ShowcaseAddCard", () => {
  test("names the things a card adds, not the screen's level", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ShowcaseAddCard onAdd={onAdd} />);

    const card = screen.getByRole("button", {
      name: "Add a note or placeholder",
    });
    expect(card).toHaveTextContent("Add a note or placeholder");
    expect(card).toHaveTextContent("Groupings too");
    expect(card).not.toHaveTextContent("level");

    await user.click(card);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
