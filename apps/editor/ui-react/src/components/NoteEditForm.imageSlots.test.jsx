import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  useCollections: () => ({ collections: [{ id: 1, name: "Test" }] }),
}));

import { getNote, getNotes, getTags } from "../lib/api.js";

const SLOT_LABELS = [
  "Front full",
  "Back full",
  "Front thumbnail",
  "Back thumbnail",
];

function notePayload(overrides = {}) {
  return {
    id: 1,
    denomination: "FIRSTNOTE",
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
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function renderForm(props = {}) {
  render(
    <MemoryRouter initialEntries={["/catalog/notes/1"]}>
      <Routes>
        <Route
          path="/catalog/notes/:id"
          element={<NoteEditForm selectedCollectionId={1} {...props} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByLabelText("Denomination");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pending files get an object URL for the dropzone preview; jsdom has no
  // implementation of either half of that pair.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
});

describe("Note editor image slots", () => {
  test("names the Note images group and gives each slot one dropzone action", async () => {
    await renderForm();

    expect(
      screen.getByRole("group", { name: "Note images" }),
    ).toBeInTheDocument();

    SLOT_LABELS.forEach((label) => {
      expect(
        screen.getByRole("group", { name: `${label} image` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Choose or drop ${label} image` }),
      ).toBeInTheDocument();
    });
  });

  test("keeps the four secondary actions behind a menu named for its slot", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: notePayload({
        images: [
          {
            type: "front",
            variant: "full",
            localPath: "/images/front.jpg",
            origin: "uploaded",
          },
        ],
      }),
    });
    await renderForm();

    expect(
      screen.queryByRole("button", { name: "Delete image" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose file" }),
    ).not.toBeInTheDocument();
    // Empty slots have nothing to clear, delete, or undo, so they carry no
    // menu at all; only the slot with a stored image does.
    expect(
      screen.getAllByRole("button", { name: / image actions$/ }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Front full image actions" }),
    );

    expect(
      await screen.findByRole("menuitem", {
        name: "Clear new file for Front full image",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: "Delete Front full image" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: "Undo delete of Front full image" }),
    ).toBeDisabled();
  });

  test("deletes and undoes a stored image from the slot menu", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: notePayload({
        images: [
          {
            type: "front",
            variant: "full",
            localPath: "/images/front.jpg",
            origin: "uploaded",
          },
        ],
      }),
    });
    await renderForm();

    expect(
      screen.getByRole("img", { name: "Front full image preview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Front full image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Delete Front full image" }),
    );

    expect(
      screen.queryByRole("img", { name: "Front full image preview" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Image will be removed")).toBeInTheDocument();
    expect(screen.getByText("Will delete")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Front full image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", {
        name: "Undo delete of Front full image",
      }),
    );

    expect(
      screen.getByRole("img", { name: "Front full image preview" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Will delete")).not.toBeInTheDocument();
  });

  test("Enter, Space, and a click on a dropzone all open its file picker", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    await renderForm();

    const dropzone = screen.getByRole("button", {
      name: "Choose or drop Back thumbnail image",
    });
    dropzone.focus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(click).toHaveBeenCalledTimes(2);

    await user.click(dropzone);
    expect(click).toHaveBeenCalledTimes(3);

    click.mockRestore();
  });

  test("a dropped file becomes the slot's pending image", async () => {
    await renderForm();

    fireEvent.drop(
      screen.getByRole("button", { name: "Choose or drop Back full image" }),
      {
        dataTransfer: {
          files: [new File(["bytes"], "back.jpg", { type: "image/jpeg" })],
        },
      },
    );

    expect(await screen.findByText("New image ready")).toBeInTheDocument();
  });

  test("a pasted screenshot becomes the slot's pending image", async () => {
    await renderForm();

    fireEvent.paste(
      screen.getByRole("button", { name: "Choose or drop Front full image" }),
      {
        clipboardData: {
          items: [
            {
              getAsFile: () =>
                new File(["bytes"], "front.jpg", { type: "image/jpeg" }),
              type: "image/jpeg",
            },
          ],
        },
      },
    );

    expect(await screen.findByText("New image ready")).toBeInTheDocument();
  });

  test("the Generate thumbnail checkbox stays inline and toggles", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: notePayload({
        images: [
          {
            type: "front",
            variant: "full",
            localPath: "/images/front.jpg",
          },
        ],
      }),
    });
    await renderForm();

    const checkbox = screen.getByRole("checkbox", {
      name: "Generate thumbnail",
    });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});

describe("Note editor image viewing", () => {
  function noteWithFullScans(images) {
    return notePayload({
      images: images.map((type) => ({
        type,
        variant: "full",
        localPath: `/images/${type}.jpg`,
        origin: "uploaded",
      })),
    });
  }

  test("offers View only for a full scan that is there", async () => {
    getNote.mockResolvedValue({ note: noteWithFullScans(["front"]) });
    await renderForm();

    expect(
      screen.getByRole("button", { name: "View Front full image" }),
    ).toBeInTheDocument();
    // No back scan, and a thumbnail has no detail to inspect on its own.
    expect(
      screen.queryByRole("button", { name: "View Back full image" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Front thumbnail image" }),
    ).not.toBeInTheDocument();
  });

  test("opens the Image popover on the scan and returns focus on close", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({ note: noteWithFullScans(["front"]) });
    await renderForm();

    const trigger = screen.getByRole("button", {
      name: "View Front full image",
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "FIRSTNOTE" });
    expect(
      within(dialog).getByRole("button", { name: "1:1" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("FIRSTNOTE, Front, image 1 of 1"),
    ).toBeInTheDocument();

    // The first Escape closes the preview (nothing is zoomed yet).
    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "FIRSTNOTE" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("pages between the two full scans and switches side", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({ note: noteWithFullScans(["front", "back"]) });
    await renderForm();

    await user.click(
      screen.getByRole("button", { name: "View Front full image" }),
    );

    expect(screen.getByText("FIRSTNOTE, Front, image 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show next image" }));
    expect(screen.getByText("FIRSTNOTE, Back, image 2 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Front" }));
    expect(screen.getByText("FIRSTNOTE, Front, image 1 of 2")).toBeInTheDocument();
  });

  test("a pending upload is what the popover shows", async () => {
    const user = userEvent.setup();
    await renderForm();

    fireEvent.drop(
      screen.getByRole("button", { name: "Choose or drop Back full image" }),
      {
        dataTransfer: {
          files: [new File(["bytes"], "back.jpg", { type: "image/jpeg" })],
        },
      },
    );

    await user.click(
      screen.getByRole("button", { name: "View Back full image" }),
    );

    expect(
      screen.getByRole("dialog", { name: "FIRSTNOTE" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("FIRSTNOTE, Back, image 1 of 1"),
    ).toBeInTheDocument();
  });

  test("the editor's note walk stays still while the popover is open", async () => {
    const user = userEvent.setup();
    const onNavigateNext = vi.fn();
    getNote.mockResolvedValue({ note: noteWithFullScans(["front"]) });
    await renderForm({ nextNoteId: 2, onNavigateNext });

    await user.click(
      screen.getByRole("button", { name: "View Front full image" }),
    );
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(onNavigateNext).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(onNavigateNext).toHaveBeenCalledTimes(1);
  });
});
