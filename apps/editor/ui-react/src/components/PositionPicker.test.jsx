import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { PositionPicker } from "./PositionPicker.jsx";

const notes = [
  {
    id: 1,
    denomination: "Five",
    catalog_number: "P-1",
    grade: "VF",
    images: [],
  },
  {
    id: 2,
    denomination: "Ten",
    catalog_number: "P-2",
    grade: "AU",
    images: [],
  },
];

describe("PositionPicker", () => {
  test("the filter input has an accessible name", () => {
    render(<PositionPicker notes={notes} onSelect={vi.fn()} selectedId={null} />);

    expect(
      screen.getByRole("textbox", {
        name: "Filter by denomination or catalog number",
      }),
    ).toBeInTheDocument();
  });

  test("typing filters the note list", async () => {
    const user = userEvent.setup();
    render(<PositionPicker notes={notes} onSelect={vi.fn()} selectedId={null} />);

    await user.type(
      screen.getByRole("textbox", {
        name: "Filter by denomination or catalog number",
      }),
      "Ten",
    );

    expect(screen.queryByText("Five")).not.toBeInTheDocument();
    expect(screen.getByText("Ten")).toBeInTheDocument();
  });
});
