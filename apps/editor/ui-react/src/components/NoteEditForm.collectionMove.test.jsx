import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteEditForm } from "./NoteEditForm.jsx";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [
      { id: 1, is_default: 1, name: "Test" },
      { id: 2, is_default: 0, name: "Other" },
    ],
  }),
}));

import {
  createNote,
  getNote,
  getNotes,
  getTags,
  moveNote,
  reorderNotes,
  updateNote,
} from "../lib/api.js";

const noteOne = {
  id: 1,
  collection_id: 1,
  display_order: 1,
  denomination: "AAAA",
  issue_date: "",
  catalog_number: "",
  grading_company: "",
  grade: "",
  watermark: "",
  serial: "",
  url: "",
  notes: "",
  tags: [],
  images: [],
  scraped_data: null,
  updated_at: "2026-01-01T00:00:00Z",
};

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="route">
      {location.pathname} {JSON.stringify(location.state)}
    </div>
  );
}

function route() {
  return screen.getByTestId("route").textContent;
}

function renderEditor(props = {}) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <LocationProbe />
      <NoteEditForm
        noteId={1}
        overlay
        selectedCollectionId={1}
        {...props}
      />
    </MemoryRouter>,
  );
}

async function chooseOther(user) {
  await screen.findByLabelText("Denomination");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Collection" }),
    "2",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getNote.mockResolvedValue({ note: { ...noteOne } });
  getNotes.mockImplementation(async (collectionId) => ({
    notes: collectionId === 1 ? [{ ...noteOne }] : [],
  }));
  getTags.mockResolvedValue({ tags: [] });
  updateNote.mockResolvedValue({ note: { ...noteOne } });
  createNote.mockImplementation(async (_payload, collectionId) => ({
    note: { ...noteOne, id: 9, collection_id: collectionId },
  }));
  moveNote.mockImplementation(async (_id, _from, to) => ({
    note: { ...noteOne, collection_id: to },
  }));
  reorderNotes.mockImplementation(async (ids, collectionId) => ({
    notes: ids.map((id) => ({ ...noteOne, id, collection_id: collectionId })),
  }));
});

describe("changing a note's collection in the editor", () => {
  test("a changed collection redirects to the destination by default", async () => {
    const user = userEvent.setup();
    renderEditor();

    await chooseOther(user);
    await user.click(
      await screen.findByRole("button", { name: "Save & close" }),
    );

    await waitFor(() => {
      expect(route()).toContain("/catalog/collections/2/view");
    });
    expect(route()).toContain('"toast":"Moved to Other."');
    expect(route()).toContain('"highlightNoteId":1');
  });

  test("turning the checkbox off keeps the save on this screen", async () => {
    const user = userEvent.setup();
    const onSaveSuccess = vi.fn();
    renderEditor({ onSaveSuccess });

    await chooseOther(user);
    await user.click(
      screen.getByRole("checkbox", { name: "Show Other after saving" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Save & close" }),
    );

    await waitFor(() => {
      expect(onSaveSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onSaveSuccess.mock.calls[0][2]).toMatchObject({
      id: 2,
      name: "Other",
    });
    expect(onSaveSuccess.mock.calls[0][4]).toBe("Moved to Other.");
    expect(route()).toContain("/catalog/collections/1/view");
  });

  test("creating into another collection names it in the redirect", async () => {
    const user = userEvent.setup();
    renderEditor({ noteId: null });

    await screen.findByLabelText("Denomination");
    await user.type(screen.getByLabelText("Denomination"), "NEW");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Collection" }),
      "2",
    );
    await user.click(await screen.findByRole("button", { name: "Add & close" }));

    await waitFor(() => {
      expect(createNote).toHaveBeenCalledTimes(1);
    });
    expect(createNote.mock.calls[0][1]).toBe(2);
    expect(moveNote).not.toHaveBeenCalled();
    expect(route()).toContain("/catalog/collections/2/view");
    expect(route()).toContain('"toast":"Note added to Other."');
  });

  test("creating in the current collection stays silent", async () => {
    const user = userEvent.setup();
    const onSaveSuccess = vi.fn();
    renderEditor({ noteId: null, onSaveSuccess });

    await screen.findByLabelText("Denomination");
    await user.type(screen.getByLabelText("Denomination"), "NEW");
    await user.click(await screen.findByRole("button", { name: "Add & close" }));

    await waitFor(() => {
      expect(onSaveSuccess).toHaveBeenCalledTimes(1);
    });
    expect(createNote.mock.calls[0][1]).toBe(1);
    expect(onSaveSuccess.mock.calls[0]).toHaveLength(4);
    expect(route()).toContain("/catalog/collections/1/view");
  });
});
