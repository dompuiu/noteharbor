import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    catalog_number: `M${id}`,
    collection_name: "Kingdom",
    owned: true,
    images: [],
    ...overrides,
  };
}

const notes = Array.from({ length: 12 }, (_, index) => note(index + 1));
const collections = [{ id: 1, name: "Kingdom" }];

function renderPicker(props = {}) {
  return render(
    <MemoryRouter>
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Group", children: [] }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

async function openPicker(props, name = "Add notes") {
  const user = userEvent.setup();
  renderPicker(props);
  const dialog = await screen.findByRole("dialog", { name });
  const boxes = within(dialog)
    .getAllByRole("checkbox")
    .filter((box) => box.closest(".showcase-note-row"));

  return { boxes, dialog, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAllNotes.mockResolvedValue({ notes });
});

describe("ShowcaseNotePicker keyboard navigation", () => {
  test("opens with the filter focused", async () => {
    const { dialog } = await openPicker();

    expect(within(dialog).getByRole("searchbox")).toHaveFocus();
  });

  test("Down from the filter lands on the first row and Up returns to it", async () => {
    const { boxes, dialog, user } = await openPicker();
    const filter = within(dialog).getByRole("searchbox");

    filter.focus();
    await user.keyboard("{ArrowDown}");
    expect(boxes[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(boxes[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(boxes[0]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(filter).toHaveFocus();
  });

  test("j/k walk the rows like the Table", async () => {
    const { boxes, dialog, user } = await openPicker();

    within(dialog).getByRole("searchbox").focus();
    await user.keyboard("{ArrowDown}j");
    expect(boxes[1]).toHaveFocus();

    await user.keyboard("k");
    expect(boxes[0]).toHaveFocus();
  });

  test("Space and Enter toggle the focused note", async () => {
    const { boxes, dialog, user } = await openPicker();

    within(dialog).getByRole("searchbox").focus();
    await user.keyboard("{ArrowDown}");

    await user.keyboard(" ");
    expect(boxes[0]).toBeChecked();

    await user.keyboard(" ");
    expect(boxes[0]).not.toBeChecked();

    await user.keyboard("{Enter}");
    expect(boxes[0]).toBeChecked();
  });

  test("Home and End jump to the first and last rows", async () => {
    const { boxes, dialog, user } = await openPicker();

    within(dialog).getByRole("searchbox").focus();
    await user.keyboard("{ArrowDown}");
    expect(boxes[0]).toHaveFocus();

    await user.keyboard("{End}");
    expect(boxes[boxes.length - 1]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(boxes[0]).toHaveFocus();
  });

  test("PageDown and PageUp move by the visible page", async () => {
    const { boxes, dialog, user } = await openPicker();

    within(dialog).getByRole("searchbox").focus();
    await user.keyboard("{ArrowDown}");

    // jsdom has no layout, so the picker falls back to a five-row page.
    await user.keyboard("{PageDown}");
    expect(boxes[5]).toHaveFocus();

    await user.keyboard("{PageUp}");
    expect(boxes[0]).toHaveFocus();
  });

  test("skips rows that are already attached when walking", async () => {
    getAllNotes.mockResolvedValue({
      notes: [note(1), note(2), note(3)],
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ShowcaseNotePicker
          collections={collections}
          embedded
          node={{
            id: 10,
            name: "Group",
            children: [{ id: 20, node_type: "note", note_id: 2 }],
          }}
          onAdd={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const region = await screen.findByRole("region", { name: "Add notes" });
    const boxes = within(region)
      .getAllByRole("checkbox")
      .filter((box) => box.closest(".showcase-note-row"));

    within(region).getByRole("searchbox").focus();
    await user.keyboard("{ArrowDown}");
    expect(boxes[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    // The middle note is disabled ("Added"), so the cursor lands on the third.
    expect(boxes[1]).toBeDisabled();
    expect(boxes[2]).toHaveFocus();
  });
});

describe("ShowcaseNotePicker table header", () => {
  test("the header checkbox selects and clears the visible window", async () => {
    const { boxes, dialog, user } = await openPicker();
    const selectAll = within(dialog).getByRole("checkbox", {
      name: "Select all visible notes",
    });

    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    boxes.forEach((box) => expect(box).toBeChecked());

    await user.click(selectAll);
    expect(selectAll).not.toBeChecked();
    boxes.forEach((box) => expect(box).not.toBeChecked());
  });

  test("a partial pick leaves the header checkbox indeterminate", async () => {
    const { boxes, dialog, user } = await openPicker();
    const selectAll = within(dialog).getByRole("checkbox", {
      name: "Select all visible notes",
    });

    await user.click(boxes[0]);

    await waitFor(() => expect(selectAll.indeterminate).toBe(true));
    expect(selectAll).not.toBeChecked();
  });
});

describe("ShowcaseNotePicker shell", () => {
  test("the replace finder wears the Add dialog's shell and closes with X", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderPicker({
      singleSelect: true,
      node: { id: 10, name: "Pick M5", node_type: "catalog_entry" },
      onClose,
    });

    const dialog = await screen.findByRole("dialog", { name: "Replace note" });
    expect(dialog).toHaveClass(
      "showcase-manager",
      "showcase-add-dialog",
      "showcase-picker-dialog",
    );
    expect(
      within(dialog).getByRole("heading", {
        name: "Replace “Pick M5” with a note",
      }),
    ).toBeInTheDocument();
    expect(dialog.querySelector(".showcase-picker-body")).not.toBeNull();
    expect(
      within(dialog).queryByRole("checkbox", {
        name: "Select all visible notes",
      }),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Close note picker" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("rows keep their columns aligned in the catalog finder", async () => {
    const { dialog } = await openPicker(
      {
        singleSelect: true,
        node: { id: 10, name: "Pick M5", node_type: "catalog_entry" },
      },
      "Replace note",
    );
    const rows = dialog.querySelectorAll(".showcase-note-row");

    expect(rows.length).toBe(notes.length);
    rows.forEach((row) => {
      expect(row).toHaveClass("showcase-note-row--catalog");
      expect(row.querySelector(".showcase-note-row-catalog")).not.toBeNull();
      expect(row.querySelector(".showcase-note-row-collection")).not.toBeNull();
      expect(row.querySelector(".showcase-note-row-status")).not.toBeNull();
    });
  });
});
