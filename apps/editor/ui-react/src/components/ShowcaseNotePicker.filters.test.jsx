import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  getAllNotes: vi.fn(),
}));

import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { getAllNotes } from "../lib/api.js";
import { chooseFilterField } from "../test/filterBar.js";

function note(id, overrides = {}) {
  return {
    id,
    denomination: "1 leu",
    issue_date: "1917",
    catalog_number: "22",
    collection_name: "Kingdom",
    collection_order: 1,
    images: [],
    tags: [],
    ...overrides,
  };
}

const notes = [
  note(101, { denomination: "1 leu", issue_date: "1917", catalog_number: "22" }),
  note(102, {
    denomination: "2 lei",
    issue_date: "1950",
    catalog_number: "22a",
    tags: [{ name: "Rare" }],
  }),
  note(103, {
    denomination: "1 leu",
    issue_date: "1920",
    catalog_number: "220",
    collection_name: "Inflation",
    collection_order: 2,
    tags: [{ name: "Rare" }],
  }),
  note(104, {
    denomination: "5 lei",
    issue_date: "1943",
    catalog_number: "M1",
    collection_name: "Inflation",
    collection_order: 2,
  }),
];

const collections = [
  { id: 1, name: "Kingdom" },
  { id: 2, name: "Inflation" },
];

function renderPicker() {
  return render(
    <MemoryRouter>
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Group", children: [] }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function filterInput(label) {
  return screen.getByRole("searchbox", { name: `Filter ${label}` });
}

async function commitChip(user, label, value) {
  await chooseFilterField(user, label);
  await user.type(filterInput(label), `${value}{Enter}`);
}

function rowLabels(dialog) {
  return within(dialog)
    .getAllByRole("checkbox")
    .filter((box) => box.closest(".showcase-note-row"))
    .map((box) => box.getAttribute("aria-label"));
}

// The mode control's name gains a `Flip:` prefix while the field has a draft,
// so both states are found by the part that names the target mode.
function filterModeButton(target) {
  return screen.getByRole("button", {
    name: new RegExp(`switch commit mode to ${target} \\(currently`, "i"),
  });
}

async function chooseSortHeader(user, label) {
  await user.click(
    screen.getByRole("button", { name: new RegExp(`^Sort by ${label}`) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getAllNotes.mockResolvedValue({ notes });
});

describe("ShowcaseNotePicker filter bar", () => {
  test("commits chips with Replace and keeps another field's chips", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await commitChip(user, "Catalog", "22");

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
    ]);

    // Replace is the default: the new field's chip joins the catalog chip
    // instead of clearing the whole filter.
    await commitChip(user, "Denomination", "1 leu");

    expect(dialog.querySelector(".table-filter-chips")).toHaveTextContent(
      "Catalog22",
    );
    expect(dialog.querySelector(".table-filter-chips")).toHaveTextContent(
      "Denomination1 leu",
    );
    expect(rowLabels(dialog)).toEqual(["1 leu · 1917 22 Kingdom"]);
  });

  test("Add mode widens the same field's OR run", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await commitChip(user, "Catalog", "22");
    await commitChip(user, "Denomination", "1 leu");

    await user.click(filterModeButton("Add"));
    await commitChip(user, "Catalog", "220");

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "1 leu · 1920 220 Inflation",
    ]);
  });

  test("ranges and negation reach the picker like the Table", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await user.type(filterInput("Catalog"), "22-25{Enter}");
    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
    ]);

    await commitChip(user, "Denomination", "!2 lei");
    expect(rowLabels(dialog)).toEqual(["1 leu · 1917 22 Kingdom"]);
  });

  test("sorts from the header and reverses the direction", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await chooseSortHeader(user, "Note");

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "1 leu · 1920 220 Inflation",
      "2 lei · 1950 22a Kingdom",
      "5 lei · 1943 M1 Inflation",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Sort by Note, ascending" }),
    );

    expect(rowLabels(dialog)).toEqual([
      "5 lei · 1943 M1 Inflation",
      "2 lei · 1950 22a Kingdom",
      "1 leu · 1917 22 Kingdom",
      "1 leu · 1920 220 Inflation",
    ]);
    expect(
      screen.getByRole("button", { name: "Sort by Note, descending" }),
    ).toBeInTheDocument();
  });

  test("filters by collection and tags", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await commitChip(user, "Collection", "Kingdom");
    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
    ]);

    await commitChip(user, "Tags", "Rare");
    expect(rowLabels(dialog)).toEqual(["2 lei · 1950 22a Kingdom"]);
  });

  test("sorts by collection order and a third click restores the default order", async () => {
    const user = userEvent.setup();

    renderPicker();
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await chooseSortHeader(user, "Collection");

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
      "1 leu · 1920 220 Inflation",
      "5 lei · 1943 M1 Inflation",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Sort by Collection, ascending" }),
    );

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1920 220 Inflation",
      "5 lei · 1943 M1 Inflation",
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Sort by Collection, descending" }),
    );

    expect(rowLabels(dialog)).toEqual([
      "1 leu · 1917 22 Kingdom",
      "2 lei · 1950 22a Kingdom",
      "1 leu · 1920 220 Inflation",
      "5 lei · 1943 M1 Inflation",
    ]);
    expect(
      screen.getByRole("button", { name: "Sort by Collection" }),
    ).toBeInTheDocument();
  });
});
