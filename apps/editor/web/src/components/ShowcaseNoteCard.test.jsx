import { fireEvent, render, screen } from "@testing-library/react";
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
});
