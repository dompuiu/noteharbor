import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";

const FRONT = {
  type: "front",
  variant: "thumbnail",
  localPath: "/api/images/notes/101/front.jpg",
};
const BACK = {
  type: "back",
  variant: "thumbnail",
  localPath: "/api/images/notes/101/back.jpg",
};

function note(overrides = {}) {
  return {
    id: 101,
    catalog_number: "22a",
    denomination: "1 leu",
    issue_date: "1917",
    images: [FRONT, BACK],
    owned: true,
    tags: [],
    updated_at: "rev-101",
    ...overrides,
  };
}

function noteNode(theNote, id = 20) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: 10,
    note_id: theNote.id,
    cover_note_id: null,
    position: 1,
    note: theNote,
    cover_note: null,
    children: [],
  };
}

function entryNode(id = 21) {
  return {
    id,
    node_type: "catalog_entry",
    name: null,
    category_id: null,
    parent_node_id: 10,
    note_id: null,
    cover_note_id: null,
    position: 1,
    note: null,
    cover_note: null,
    children: [],
    entry: {
      catalog_number: "22a",
      denomination: "1 leu",
      issue_date: "1917",
      source: "",
      notes: "",
    },
  };
}

function visibleImage(card) {
  return within(card).getByRole("img");
}

describe("ShowcaseCatalogCard face flip", () => {
  test("hover reveals the flip control but keeps the front", () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/front.jpg?v=rev-101",
    );

    const cell = card.closest(".showcase-cell");
    fireEvent.mouseEnter(cell);
    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");

    fireEvent.mouseLeave(cell);
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("focus reveals the control without swapping", () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    act(() => card.focus());

    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("the whole cell reveals the control, including the ownership footer", () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    const cell = card.closest(".showcase-cell");
    const footer = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
    });

    fireEvent.mouseEnter(cell);
    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    fireEvent.mouseLeave(cell);
    expect(card.querySelector(".showcase-card-flip")).toBeNull();

    act(() => footer.focus());
    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    act(() => footer.blur());
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
  });

  test("the flip control shows the back and never opens the card", async () => {
    const onOpenNote = vi.fn();
    render(
      <ShowcaseCatalogCard node={noteNode(note())} onOpenNote={onOpenNote} />,
    );

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    await userEvent.click(card.querySelector(".showcase-card-flip"));

    expect(onOpenNote).not.toHaveBeenCalled();
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/back.jpg?v=rev-101",
    );

    await userEvent.click(card.querySelector(".showcase-card-flip"));
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/front.jpg?v=rev-101",
    );
  });

  test("clicking the card body while back opens the note at that face", async () => {
    const onOpenNote = vi.fn();
    render(
      <ShowcaseCatalogCard node={noteNode(note())} onOpenNote={onOpenNote} />,
    );

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    await userEvent.click(card.querySelector(".showcase-card-flip"));

    await userEvent.click(card);
    expect(onOpenNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: 20 }),
      "back",
    );
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  test("leaving the card returns to the front", async () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    await userEvent.click(card.querySelector(".showcase-card-flip"));
    expect(card).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseLeave(card.closest(".showcase-cell"));
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(card).not.toHaveFocus();
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/front.jpg?v=rev-101",
    );
  });

  test("blurring the card returns to the front", async () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    act(() => card.focus());
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).toHaveAttribute("aria-pressed", "true");

    act(() => card.blur());
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("Shift or Ctrl plus an arrow flips; a plain arrow does not", () => {
    render(<ShowcaseCatalogCard node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    act(() => card.focus());

    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(card).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveFocus();

    fireEvent.keyDown(card, { key: "ArrowLeft", ctrlKey: true });
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("a front-only note has no flip control and never swaps", () => {
    render(
      <ShowcaseCatalogCard
        node={noteNode(note({ images: [FRONT] }))}
      />,
    );

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    act(() => card.focus());

    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(card).not.toHaveAttribute("aria-pressed");
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).not.toHaveAttribute("aria-pressed");
  });

  test("a back-only note shows the back and has no flip control", () => {
    render(
      <ShowcaseCatalogCard
        node={noteNode(note({ images: [BACK] }))}
      />,
    );

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    act(() => card.focus());

    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(card).not.toHaveAttribute("aria-pressed");
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/back.jpg?v=rev-101",
    );
  });

  test("the auction rail layout flips the same way", async () => {
    render(<ShowcaseCatalogCard layout="rail" node={noteNode(note())} />);

    const card = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    await userEvent.click(card.querySelector(".showcase-card-flip"));

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(visibleImage(card)).toHaveAttribute(
      "src",
      "/api/images/notes/101/back.jpg?v=rev-101",
    );
  });

  test("an entry card draws the well, not a note's notes", () => {
    render(<ShowcaseCatalogCard node={entryNode()} />);

    const card = screen.getByRole("button", {
      name: /is unseen\. Replace with note/,
    });

    expect(card.querySelector(".showcase-card-notes")).toBeNull();
    expect(card.querySelector(".showcase-catalog-notes")).toBeNull();
    expect(card.querySelector(".showcase-catalog-wellshot")).not.toBeNull();
    expect(card).not.toHaveAccessibleDescription(/Notes/);
  });

  test("the auction rail says a shell holds no specimen", () => {
    render(<ShowcaseCatalogCard layout="rail" node={entryNode()} />);

    const card = screen.getByRole("button", {
      name: /is unseen\. Replace with note/,
    });
    const rail = card.querySelector(".showcase-catalog-rail");

    expect(rail).toHaveTextContent("No specimen recorded yet.");
    expect(rail.querySelector(".showcase-card-notes")).toBeNull();
    expect(rail.querySelector(".showcase-catalog-notes")).toBeNull();
  });
});

describe("ShowcaseCatalogCard placeholder notes", () => {
  function unseenEntry(notes) {
    const node = entryNode();

    return { ...node, entry: { ...node.entry, notes } };
  }

  test("the library label reads the placeholder's notes under the date", () => {
    render(<ShowcaseCatalogCard node={unseenEntry("Hunt the overprint.")} />);

    const card = screen.getByRole("button", {
      name: /is unseen\. Replace with note/,
    });
    const line = card.querySelector(".showcase-catalog-notes");

    expect(line).toHaveTextContent("Hunt the overprint.");
    expect(line).toHaveAttribute("title", "Hunt the overprint.");
    expect(line.querySelector(".showcase-catalog-notes-label")).toHaveTextContent(
      "Note",
    );
    expect(line.parentElement?.className).toBe(
      "showcase-catalog-meta showcase-catalog-meta--placeholder",
    );
    expect(line.previousElementSibling?.className).toBe(
      "showcase-catalog-line",
    );
  });

  test("the auction rail reads the placeholder's notes under the date", () => {
    render(
      <ShowcaseCatalogCard
        layout="rail"
        node={unseenEntry("Hunt the overprint.")}
      />,
    );

    const card = screen.getByRole("button", {
      name: /is unseen\. Replace with note/,
    });
    const line = card.querySelector(
      ".showcase-catalog-rail .showcase-catalog-notes",
    );

    expect(line).toHaveTextContent("Hunt the overprint.");
    expect(line.previousElementSibling?.className).toBe(
      "showcase-catalog-date",
    );
  });
});
