import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  getAllNotes: vi.fn(),
}));

import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { getAllNotes } from "../lib/api.js";

function note(id, overrides = {}) {
  return {
    id,
    denomination: `Note ${id}`,
    issue_date: "1917",
    catalog_number: "22",
    collection_name: "Kingdom",
    owned: true,
    images: [],
    tags: [],
    ...overrides,
  };
}

const gradedNotes = [
  note(1, { grade: "66 EPQ", grading_company: "PMG" }),
  note(2),
  note(3, { grade: "58", grading_company: "PCGS" }),
];

const collections = [{ id: 1, name: "Kingdom" }];

function renderEmbedded() {
  return render(
    <MemoryRouter>
      <ShowcaseNotePicker
        collections={collections}
        embedded
        node={{ id: 10, name: "Pick 22a" }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function rows(dialog) {
  return within(dialog)
    .getAllByRole("checkbox")
    .filter((box) => box.closest(".showcase-note-row"))
    .map((box) => box.closest(".showcase-note-row"));
}

function gradingSortButton(dialog) {
  return within(dialog).getByRole("button", {
    name: /^Sort by Grading/,
  });
}

async function openPicker() {
  renderEmbedded();
  return screen.findByRole("region", { name: "Add notes" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAllNotes.mockResolvedValue({ notes: gradedNotes });
});

describe("ShowcaseNotePicker grading column", () => {
  test("shows each note's company and grade, and a dash for an ungraded note", async () => {
    const dialog = await openPicker();
    const [graded, ungraded, other] = rows(dialog);

    expect(gradingSortButton(dialog)).toBeInTheDocument();
    expect(within(graded).getByText("PMG 66 EPQ")).toBeInTheDocument();
    expect(within(other).getByText("PCGS 58")).toBeInTheDocument();
    expect(within(ungraded).getByText("—")).toBeInTheDocument();
  });

  test("sorts by grade, leaving an ungraded note last", async () => {
    const user = userEvent.setup();

    const dialog = await openPicker();
    await user.click(gradingSortButton(dialog));

    expect(
      rows(dialog).map((row) =>
        row.querySelector(".showcase-note-row-grading")?.textContent,
      ),
    ).toEqual(["PCGS 58", "PMG 66 EPQ", "—"]);
  });

  test("keeps a partial grading legible", async () => {
    getAllNotes.mockResolvedValue({
      notes: [
        note(4, { grading_company: "PMG" }),
        note(5, {
          grade: "66 EPQ",
          catalog_number: "",
          collection_name: "",
        }),
      ],
    });

    const dialog = await openPicker();
    const [companyOnly, gradeOnly] = rows(dialog);

    expect(within(companyOnly).getByText("PMG")).toBeInTheDocument();
    expect(
      within(companyOnly).getByRole("checkbox", {
        name: "Note 4 · 1917 22 PMG Kingdom",
      }),
    ).toBeInTheDocument();
    expect(within(gradeOnly).getByText("66 EPQ")).toBeInTheDocument();
    expect(
      within(gradeOnly).getByRole("checkbox", {
        name: "Note 5 · 1917 66 EPQ",
      }),
    ).toBeInTheDocument();
  });

  test("announces the grading with the row's checkbox", async () => {
    getAllNotes.mockResolvedValue({ notes: [gradedNotes[0]] });

    const dialog = await openPicker();

    expect(
      within(dialog).getByRole("checkbox", {
        name: "Note 1 · 1917 22 PMG 66 EPQ Kingdom",
      }),
    ).toBeInTheDocument();
  });
});
