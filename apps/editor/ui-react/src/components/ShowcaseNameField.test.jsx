import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ShowcaseNameField } from "./ShowcaseNameField.jsx";

const CATEGORIES = [
  { id: 1, name: "Summer" },
  { id: 2, name: "Vienna" },
];

function Harness({ suggestions = [] }) {
  const [value, setValue] = useState("");

  return (
    <ShowcaseNameField
      label="Category name"
      onChange={setValue}
      suggestions={suggestions}
      suggestionsLabel="Category suggestions"
      value={value}
    />
  );
}

describe("ShowcaseNameField", () => {
  test("a plain field has no suggestion list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText("Category name");
    await user.type(input, "Winter");

    expect(input).toHaveValue("Winter");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("the pool ranks starts-with first and Enter fills the field", async () => {
    const user = userEvent.setup();
    render(<Harness suggestions={CATEGORIES} />);

    const input = screen.getByRole("combobox", { name: "Category name" });
    await user.type(input, "v");
    await user.keyboard("{ArrowDown}");

    expect(
      screen.getByRole("listbox", { name: "Category suggestions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Vienna" })).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(input).toHaveValue("Vienna");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
