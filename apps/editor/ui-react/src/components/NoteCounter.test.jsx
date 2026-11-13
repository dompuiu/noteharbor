import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { NoteCounter } from "./NoteCounter.jsx";

function renderCounter(props = {}) {
  return render(
    <NoteCounter position={3} total={9} {...props} />,
  );
}

function renderedValue(container) {
  return container.querySelector(".note-counter-value");
}

describe("NoteCounter", () => {
  test("renders the position and total as visible text", () => {
    const { container } = renderCounter();

    expect(renderedValue(container)).toHaveTextContent("3 / 9");
  });

  test("the separator joins the two numbers as a caller spells it", () => {
    const { container } = renderCounter({ separator: " of " });

    expect(renderedValue(container)).toHaveTextContent("3 of 9");
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

  test("an optional label names what the numbers count", () => {
    const { container } = renderCounter({ label: "Image" });

    expect(container.querySelector(".note-counter-label")).toHaveTextContent(
      "Image",
    );
    expect(renderedValue(container)).toHaveTextContent("Image 3 / 9");
  });

  test("no label is rendered by default", () => {
    const { container } = renderCounter();

    expect(
      container.querySelector(".note-counter-label"),
    ).not.toBeInTheDocument();
  });

  test("the add variant renders ? / N and never a number", () => {
    const { container } = renderCounter({
      addMode: true,
      position: null,
      total: 4,
    });
    const counter = renderedValue(container);

    expect(counter).toHaveTextContent("? / 4");
    expect(counter).not.toHaveTextContent("1 / 4");
    expect(counter).not.toHaveTextContent("0 / 4");
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

  test("the textbox exposes the number alone, not the total", async () => {
    renderCounter({ onJump: vi.fn(), total: 9 });

    const field = screen.getByRole("textbox", { name: "Note position" });

    expect(field).toHaveTextContent(/^3$/);
    expect(field).not.toHaveTextContent("/");
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
    expect(
      screen
        .getByRole("textbox", { name: "Note position" })
        .closest(".note-counter-value"),
    ).toHaveTextContent("3 / 20");
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
