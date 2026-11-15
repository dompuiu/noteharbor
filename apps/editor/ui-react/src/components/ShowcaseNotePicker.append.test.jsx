import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  getAllNotes: vi.fn(),
}));

import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { getAllNotes } from "../lib/api.js";
import { showcasePickerFields } from "../lib/noteFields.js";

function note(id, overrides = {}) {
  return {
    id,
    denomination: `Note ${id}`,
    issue_date: "1917",
    catalog_number: "22",
    collection_name: "Kingdom",
    owned: true,
    updated_at: `rev${id}`,
    images: [],
    ...overrides,
  };
}

const collections = [{ id: 1, name: "Kingdom" }];

function renderEmbedded(props = {}) {
  return render(
    <ShowcaseNotePicker
      collections={collections}
      embedded
      node={{ id: 10, name: "Pick 22a" }}
      onAdd={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShowcaseNotePicker append mode", () => {
  test("embeds inline without its own modal shell or closing actions", async () => {
    getAllNotes.mockResolvedValue({ notes: [note(1)] });

    renderEmbedded();

    const region = await screen.findByRole("region", { name: "Add notes" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(region.querySelector(".showcase-picker-backdrop")).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "Add & close" }),
    ).not.toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();
  });

  test("excludes the entry's attached notes from the list and the count", async () => {
    getAllNotes.mockResolvedValue({
      notes: [note(1), note(2), note(3)],
    });

    renderEmbedded({ excludeNoteIds: [2] });

    const region = await screen.findByRole("region", { name: "Add notes" });
    expect(await within(region).findByText("2 notes")).toBeInTheDocument();

    const boxes = within(region).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(
      boxes.map((box) => box.getAttribute("aria-label")),
    ).toEqual([
      "Note 1 · 1917 22 Kingdom",
      "Note 3 · 1917 22 Kingdom",
    ]);
  });

  test("chips each row Owned or Seen and sorts owned notes first", async () => {
    getAllNotes.mockResolvedValue({
      notes: [
        note(1, { owned: false }),
        note(2, { owned: true }),
        note(3, { owned: true }),
      ],
    });

    renderEmbedded();

    const region = await screen.findByRole("region", { name: "Add notes" });
    const boxes = await within(region).findAllByRole("checkbox");

    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Note 2 · 1917 22 Kingdom",
      "Note 3 · 1917 22 Kingdom",
      "Note 1 · 1917 22 Kingdom",
    ]);
    expect(within(region).getAllByText("Owned")).toHaveLength(2);
    expect(within(region).getAllByText("Seen")).toHaveLength(1);
  });

  test("keeps multi-select and appends every picked note in one call", async () => {
    const notes = [note(1), note(2), note(3)];
    getAllNotes.mockResolvedValue({ notes });
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderEmbedded({ onAdd });

    const region = await screen.findByRole("region", { name: "Add notes" });
    await user.click(within(region).getByRole("checkbox", { name: /Note 1/ }));
    await user.click(within(region).getByRole("checkbox", { name: /Note 3/ }));
    await user.click(
      within(region).getByRole("button", { name: "Add selected (2)" }),
    );

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toEqual([1, 3]);
    expect(onAdd.mock.calls[0][1]).toBe(notes);
  });

  test("says the list is exhausted when every note is already attached", async () => {
    getAllNotes.mockResolvedValue({ notes: [note(1)] });

    renderEmbedded({ excludeNoteIds: [1] });

    const region = await screen.findByRole("region", { name: "Add notes" });
    expect(
      await within(region).findByText("Every note is already on this entry."),
    ).toBeInTheDocument();
  });

  test("the unseen entry's standalone finder also chips and sorts owned first", async () => {
    getAllNotes.mockResolvedValue({
      notes: [note(1, { owned: false }), note(2, { owned: true })],
    });

    render(
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Pick 22a", node_type: "catalog_entry" }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    const boxes = within(dialog).getAllByRole("checkbox");

    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Note 2 · 1917 22 Kingdom",
      "Note 1 · 1917 22 Kingdom",
    ]);
    expect(within(dialog).getAllByText("Owned")).toHaveLength(1);
    expect(within(dialog).getAllByText("Seen")).toHaveLength(1);
  });

  test("still loads with the picker fields the draft finder uses", async () => {
    getAllNotes.mockResolvedValue({ notes: [] });

    renderEmbedded();

    await screen.findByRole("region", { name: "Add notes" });
    expect(getAllNotes).toHaveBeenCalledWith(collections, showcasePickerFields);
  });
});
