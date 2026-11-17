import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseNameField } from "./ShowcaseNameField.jsx";

const CATEGORIES = [
  { id: 1, name: "Summer", showcase_count: 0 },
  { id: 2, name: "Vienna", showcase_count: 0 },
];

function Harness({ onDelete, suggestions = [] }) {
  const [value, setValue] = useState("");

  return (
    <ShowcaseNameField
      label="Category name"
      onChange={setValue}
      onDelete={onDelete}
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

  test("an unused suggestion carries a delete action that does not pick it", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} suggestions={CATEGORIES} />);

    const input = screen.getByRole("combobox", { name: "Category name" });
    await user.type(input, "v");
    await user.keyboard("{ArrowDown}");

    await user.click(
      screen.getByRole("button", {
        name: "Delete Vienna from the category pool",
      }),
    );

    expect(onDelete).toHaveBeenCalledWith(CATEGORIES[1]);
    expect(input).toHaveValue("v");
    expect(
      screen.getByRole("listbox", { name: "Category suggestions" }),
    ).toBeInTheDocument();
  });

  test("Delete removes the highlighted unused suggestion", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} suggestions={CATEGORIES} />);

    const input = screen.getByRole("combobox", { name: "Category name" });
    await user.type(input, "v");
    await user.keyboard("{ArrowDown}{Delete}");

    expect(onDelete).toHaveBeenCalledWith(CATEGORIES[1]);
    expect(input).toHaveValue("v");
  });

  test("a placed suggestion shows its showcase count instead of delete", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <Harness
        onDelete={onDelete}
        suggestions={[{ id: 3, name: "Shared", showcase_count: 2 }]}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Category name" });
    await user.type(input, "s");
    await user.keyboard("{ArrowDown}{Delete}");

    expect(
      screen.getByRole("option", { name: "Shared, placed in 2 showcases" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 showcases")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Delete Shared from the category pool",
      }),
    ).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(input).toHaveValue("s");
  });
});
