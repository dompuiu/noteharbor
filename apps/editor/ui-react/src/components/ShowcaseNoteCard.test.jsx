import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";

function note(overrides = {}) {
  return {
    id: 1,
    denomination: "1 leu",
    issue_date: "1917",
    updated_at: "rev-1",
    images: [
      {
        type: "front",
        variant: "thumbnail",
        localPath: "/api/images/notes/1/front-thumb.jpg",
      },
      {
        type: "back",
        variant: "thumbnail",
        localPath: "/api/images/notes/1/back-thumb.jpg",
      },
    ],
    ...overrides,
  };
}

describe("ShowcaseNoteCard", () => {
  test("shows the front image with the caption and the note label", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toHaveTextContent("1 leu · 1917");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("view mode pressed shows the back", () => {
    render(<ShowcaseNoteCard note={note()} pressed />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/back-thumb.jpg?v=rev-1",
    );
  });

  test("edit mode always shows the front even when pressed", () => {
    render(<ShowcaseNoteCard mode="edit" note={note()} pressed />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("clicking never latches the back image", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.click(card);
    fireEvent.click(card);

    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("a mouse click never holds the back after the pointer leaves", async () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    await userEvent.click(card);
    // Focus must not stick to the clicked card, or keyboard users would find
    // a stale focus ring after a mouse tap.
    expect(card).not.toHaveFocus();

    await userEvent.unhover(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("hover reveals the flip control without swapping to the back", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card.querySelector(".showcase-card-flip")).toBeNull();

    fireEvent.mouseEnter(card);
    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );

    fireEvent.mouseLeave(card);
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("focus reveals the flip control without swapping to the back", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    act(() => card.focus());

    expect(card.querySelector(".showcase-card-flip")).not.toBeNull();
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );

    act(() => card.blur());
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
  });

  test("clicking the flip control toggles the back and blur returns", async () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(card);

    const flip = card.querySelector(".showcase-card-flip");
    expect(flip).not.toBeNull();

    await userEvent.click(flip);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/back-thumb.jpg?v=rev-1",
    );

    await userEvent.click(flip);
    expect(card).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(flip);
    expect(card).toHaveAttribute("aria-pressed", "true");
    act(() => card.blur());
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("clicking the card body while back keeps the back; only the icon flips back", async () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(card);

    const flip = card.querySelector(".showcase-card-flip");
    await userEvent.click(flip);
    expect(card).toHaveAttribute("aria-pressed", "true");

    // A tap on the card body parks focus but never returns to the front.
    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/back-thumb.jpg?v=rev-1",
    );

    // Only the flip control returns to the front.
    await userEvent.click(card.querySelector(".showcase-card-flip"));
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("moving the pointer out returns to the front", async () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(card);

    const flip = card.querySelector(".showcase-card-flip");
    expect(flip).not.toBeNull();

    await userEvent.click(flip);
    expect(card).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseLeave(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("Shift or Ctrl plus an arrow flips; a plain arrow does not", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    act(() => card.focus());

    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(card).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/back-thumb.jpg?v=rev-1",
    );

    fireEvent.keyDown(card, { key: "ArrowLeft", ctrlKey: true });
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("no flip control without a distinct back", () => {
    const frontOnly = note({
      images: [
        {
          type: "front",
          variant: "full",
          localPath: "/api/images/notes/1/front.jpg",
        },
      ],
    });
    const { unmount } = render(<ShowcaseNoteCard note={frontOnly} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(card);
    act(() => card.focus());
    expect(card.querySelector(".showcase-card-flip")).toBeNull();
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).toHaveAttribute("aria-pressed", "false");
    unmount();

    const backOnly = note({
      images: [
        {
          type: "back",
          variant: "full",
          localPath: "/api/images/notes/1/back.jpg",
        },
      ],
    });
    render(<ShowcaseNoteCard note={backOnly} />);
    const backCard = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(backCard);
    act(() => backCard.focus());
    expect(backCard.querySelector(".showcase-card-flip")).toBeNull();
  });

  test("edit mode never shows the flip control and never flips", () => {
    render(<ShowcaseNoteCard mode="edit" note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    fireEvent.mouseEnter(card);
    act(() => card.focus());
    expect(card.querySelector(".showcase-card-flip")).toBeNull();

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumb.jpg?v=rev-1",
    );
  });

  test("a note with no images shows the muted placeholder and the caption", () => {
    render(<ShowcaseNoteCard note={note({ images: [] })} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 leu, 1917" })).toHaveTextContent(
      "1 leu · 1917",
    );
  });

  test("a back-only note shows the back and never swaps", () => {
    const backOnly = note({
      images: [
        {
          type: "back",
          variant: "full",
          localPath: "/api/images/notes/1/back.jpg",
        },
      ],
    });
    render(<ShowcaseNoteCard note={backOnly} pressed />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/1/back.jpg?v=rev-1",
    );
  });

  test("a front-only note never swaps", () => {
    const frontOnly = note({
      images: [
        {
          type: "front",
          variant: "full",
          localPath: "/api/images/notes/1/front.jpg",
        },
      ],
    });
    render(<ShowcaseNoteCard note={frontOnly} pressed />);

    expect(
      screen.getByRole("button", { name: "1 leu, 1917" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("shows the catalog number after the denomination", () => {
    render(
      <ShowcaseNoteCard
        note={note({ denomination: "1 leu", catalog_number: "17", issue_date: "1917" })}
      />,
    );

    const card = screen.getByRole("button", { name: "1 leu, Pick 17, 1917" });
    expect(card).toHaveTextContent("1 leu · Pick 17 · 1917");
  });

  test("normalizes an existing prefix", () => {
    render(
      <ShowcaseNoteCard
        note={note({ denomination: "1 leu", catalog_number: "P17", issue_date: "1917" })}
      />,
    );

    const card = screen.getByRole("button", { name: "1 leu, Pick 17, 1917" });
    expect(card).toHaveTextContent("1 leu · Pick 17 · 1917");
  });

  test("shows an info icon after the caption", () => {
    render(<ShowcaseNoteCard note={note({ notes: "Printed in Bucharest." })} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    const caption = card.querySelector(".showcase-card-caption");
    expect(caption).not.toBeNull();
    const info = card.querySelector(".showcase-card-info");
    expect(info).not.toBeNull();
    // The icon sits after the caption in the caption row.
    expect(caption.compareDocumentPosition(info)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("hovering the info icon shows the description and tags", async () => {
    render(
      <ShowcaseNoteCard
        note={note({
          notes: "Printed in Bucharest.",
          tags: [
            { id: 1, name: "paper" },
            { id: 2, name: "rare" },
          ],
        })}
      />,
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const info = document.querySelector(".showcase-card-info");
    fireEvent.mouseEnter(info);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Description:");
    expect(tooltip).toHaveTextContent("Printed in Bucharest.");
    expect(tooltip).toHaveTextContent("Tags:");
    expect(tooltip).toHaveTextContent("paper");
    expect(tooltip).toHaveTextContent("rare");

    // Moving from the icon onto the tooltip leaves the icon but enters the
    // tooltip before the close delay runs, so it stays open for reading;
    // leaving the tooltip lets the delay close it.
    fireEvent.mouseLeave(info);
    fireEvent.mouseEnter(screen.getByRole("tooltip"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("tooltip"));
    await waitForElementToBeRemoved(() => screen.queryByRole("tooltip"));
  });

  test("pressing i on a keyboard-focused card toggles the tooltip", async () => {
    render(
      <ShowcaseNoteCard
        note={note({
          notes: "Printed in Bucharest.",
          tags: [{ id: 1, name: "paper" }],
        })}
      />,
    );

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    card.focus();

    await userEvent.keyboard("i");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Printed in Bucharest.",
    );

    await userEvent.keyboard("i");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("escape dismisses the i-pinned tooltip", () => {
    render(<ShowcaseNoteCard note={note({ notes: "Printed in Bucharest." })} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    card.focus();
    fireEvent.keyDown(card, { key: "i" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(card, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("a note without description or tags shows no info icon", () => {
    render(<ShowcaseNoteCard note={note()} />);

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card.querySelector(".showcase-card-info")).toBeNull();

    card.focus();
    fireEvent.keyDown(card, { key: "i" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  test("a note with only tags shows the icon and a tags-only tooltip", () => {
    render(
      <ShowcaseNoteCard note={note({ tags: [{ id: 1, name: "paper" }] })} />,
    );

    const card = screen.getByRole("button", { name: "1 leu, 1917" });
    expect(card.querySelector(".showcase-card-info")).not.toBeNull();

    card.focus();
    fireEvent.keyDown(card, { key: "i" });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Tags:");
    expect(tooltip).toHaveTextContent("paper");
    expect(tooltip).not.toHaveTextContent("Description:");
  });
});
