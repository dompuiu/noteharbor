import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { NoteCounter } from "./NoteCounter.jsx";

function renderCounter(props = {}) {
  return render(
    <NoteCounter position={3} total={9} {...props} />,
  );
}

describe("NoteCounter", () => {
  test("renders the position and total as visible text", () => {
    renderCounter();

    expect(screen.getByText("3 / 9")).toBeInTheDocument();
  });

  test("the previous and next controls fire their callbacks", async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const user = userEvent.setup();
    renderCounter({ onNext, onPrevious });

    await user.click(screen.getByRole("button", { name: "Edit previous note" }));
    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test("the arrow controls use the supplied accessible names", () => {
    renderCounter({
      nextLabel: "Next slide",
      previousLabel: "Previous slide",
    });

    expect(
      screen.getByRole("button", { name: "Previous slide" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next slide" }),
    ).toBeInTheDocument();
  });

  test("an empty list drops the arrows", () => {
    renderCounter({ position: null, showArrows: true, total: 0 });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("the add variant renders ? / N and never a number", () => {
    renderCounter({ addMode: true, position: null, total: 4 });

    expect(screen.getByText("? / 4")).toBeInTheDocument();
    expect(screen.queryByText("1 / 4")).not.toBeInTheDocument();
    expect(screen.queryByText("0 / 4")).not.toBeInTheDocument();
  });
});

describe("NoteCounter's editable number", () => {
  async function openEditable(props = {}) {
    const onJump = vi.fn();
    const user = userEvent.setup();
    renderCounter({ onJump, total: 20, ...props });

    const field = screen.getByRole("textbox", { name: "Note position" });
    await user.click(field);
    return { onJump, user };
  }

  test("Enter jumps to the typed position", async () => {
    const { onJump, user } = await openEditable();

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "7{Enter}");

    expect(onJump).toHaveBeenCalledWith(7);
  });

  test("only digits can be typed", async () => {
    const { onJump, user } = await openEditable({ total: 200 });

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "1a2b3{Enter}");

    expect(onJump).toHaveBeenCalledWith(123);
  });

  test("an out-of-range value clamps to the nearest position", async () => {
    const { onJump, user } = await openEditable({ total: 5 });

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "99{Enter}");

    expect(onJump).toHaveBeenCalledWith(5);
  });

  test("Escape restores the current number and blurs without jumping", async () => {
    const { onJump, user } = await openEditable();

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "5");
    await user.keyboard("{Escape}");

    expect(onJump).not.toHaveBeenCalled();
    expect(screen.getByText("3 / 20")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  test("? cannot be typed", async () => {
    const { onJump, user } = await openEditable({ addMode: true, position: null });

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "?");

    expect(input).toHaveValue("");
    await user.keyboard("{Enter}");
    expect(onJump).not.toHaveBeenCalled();
  });

  test("left/right arrows move the caret instead of committing", async () => {
    const { onJump, user } = await openEditable();

    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "12");
    expect(input.selectionStart).toBe(2);

    await user.keyboard("{ArrowLeft}");

    expect(input.selectionStart).toBe(1);
    expect(onJump).not.toHaveBeenCalled();
  });
});
