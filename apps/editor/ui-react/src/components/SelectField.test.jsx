import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SelectField } from "./SelectField.jsx";

const options = [
  { label: "Start of collection", value: "start" },
  { label: "End of collection", value: "end" },
];

function Harness({ onChange = () => {} }) {
  const [value, setValue] = useState("start");

  return (
    <SelectField
      ariaLabel="Position in collection"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={options}
      value={value}
    />
  );
}

function field() {
  return screen.getByRole("combobox", { name: "Position in collection" });
}

describe("SelectField", () => {
  test("shows the current choice and opens the tag-style option list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(field()).toHaveValue("Start of collection");

    await user.click(field());
    const listbox = await screen.findByRole("listbox", {
      name: "Position in collection options",
    });
    expect(listbox).toHaveClass("tags-filter-dropdown");
    const rows = within(listbox).getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("tags-filter-option");
  });

  test("focusing the field does not open the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();

    expect(field()).toHaveFocus();
    expect(
      screen.queryByRole("listbox", {
        name: "Position in collection options",
      }),
    ).toBeNull();

    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("listbox", {
        name: "Position in collection options",
      }),
    ).toBeInTheDocument();
  });

  test("choosing a listed option commits its value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(field());
    await user.click(
      await screen.findByRole("option", { name: "End of collection" }),
    );

    expect(onChange).toHaveBeenCalledWith("end");
    expect(field()).toHaveValue("End of collection");
  });

  test("the arrows walk the list and Enter chooses", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(field());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("end");
  });

  test("a typed value that is not listed is never committed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(field());
    await user.clear(field());
    await user.type(field(), "middle{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(field()).toHaveValue("Start of collection");
  });
});
