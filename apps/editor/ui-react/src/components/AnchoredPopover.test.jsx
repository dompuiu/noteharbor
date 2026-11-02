import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { AnchoredPopover } from "./AnchoredPopover.jsx";

function Harness({
  children,
  initialFocus,
  onKeyDown,
  onOuterKeyDown,
  role = "dialog",
}) {
  return (
    <MemoryRouter>
      <div onKeyDown={onOuterKeyDown}>
        <button type="button">Outside</button>
        <AnchoredPopover
          className="test-panel"
          initialFocus={initialFocus}
          onKeyDown={onKeyDown}
          panelLabel="Test panel"
          renderTrigger={({ open, triggerProps }) => (
            <button {...triggerProps} type="button">
              {open ? "Opened" : "Open"}
            </button>
          )}
          role={role}
        >
          {children ?? (
            <>
              <input aria-label="Panel choice" type="checkbox" />
              <p>Panel body</p>
            </>
          )}
        </AnchoredPopover>
      </div>
    </MemoryRouter>
  );
}

function trigger() {
  return screen.getByRole("button", { name: /Open/ });
}

function panel() {
  return screen.queryByRole("dialog", { name: "Test panel" });
}

describe("AnchoredPopover", () => {
  test("wires the trigger's aria to the panel while it is open", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).not.toHaveAttribute("aria-controls");

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", panel().id);
    expect(trigger()).toHaveAccessibleName("Opened");

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(panel()).toBeNull();
  });

  test("names the trigger's popup after the panel's role", async () => {
    const user = userEvent.setup();
    render(<Harness role="menu" />);

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger());

    expect(screen.getByRole("menu", { name: "Test panel" })).toHaveClass(
      "test-panel",
    );
  });

  test("portals the panel out of the trigger's ancestors", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(panel().parentElement).toBe(document.body);
  });

  test("focuses the panel itself when the caller names no target", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(panel()).toHaveFocus();
  });

  test("focuses the caller's target inside the panel", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialFocus={(openPanel) => openPanel.querySelector("input")}
      />,
    );

    await user.click(trigger());

    expect(within(panel()).getByRole("checkbox")).toHaveFocus();
  });

  test("falls back to the panel when the target is missing", async () => {
    const user = userEvent.setup();
    render(<Harness initialFocus={() => null} />);

    await user.click(trigger());

    expect(panel()).toHaveFocus();
  });

  test("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  test("closes on Escape from the trigger while the panel is open", async () => {
    const user = userEvent.setup();
    const onOuterKeyDown = vi.fn();
    render(<Harness onOuterKeyDown={onOuterKeyDown} />);

    await user.click(trigger());
    trigger().focus();
    onOuterKeyDown.mockClear();
    await user.keyboard("{Escape}");

    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(onOuterKeyDown).not.toHaveBeenCalled();
  });

  test("leaves Escape alone while closed", async () => {
    const onOuterKeyDown = vi.fn();
    render(<Harness onOuterKeyDown={onOuterKeyDown} />);

    fireEvent.keyDown(trigger(), { key: "Escape" });

    expect(onOuterKeyDown).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  test("hands non-Escape keys to the caller's panel handler", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);

    await user.click(trigger());
    onKeyDown.mockClear();
    await user.keyboard("{ArrowDown}");

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0]).toMatchObject({ key: "ArrowDown" });
    expect(onKeyDown.mock.calls[0][1]).toBe(panel());
  });

  test("keeps Escape out of the caller's panel handler", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);

    await user.click(trigger());
    onKeyDown.mockClear();
    await user.keyboard("{Escape}");

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  test("gives function children a close that leaves focus alone", async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {({ close }) => (
          <button onClick={close} type="button">
            Dismiss
          </button>
        )}
      </Harness>,
    );

    await user.click(trigger());
    await user.click(within(panel()).getByRole("button", { name: "Dismiss" }));

    expect(panel()).toBeNull();
    // Dismissing from inside the panel does not yank focus back to the
    // trigger; the caller decides where focus goes next.
    expect(trigger()).not.toHaveFocus();
  });

  test("closes on a press outside the trigger and panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(panel()).toBeNull();
  });

  test("stays open when focus moves back to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    fireEvent.focusOut(panel(), { relatedTarget: trigger() });

    expect(panel()).toBeInTheDocument();
  });

  test("closes when focus leaves the trigger and panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    fireEvent.focusOut(panel(), {
      relatedTarget: screen.getByRole("button", { name: "Outside" }),
    });

    expect(panel()).toBeNull();
  });

  test("closes on a window scroll or resize", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(panel()).toBeNull());

    await user.click(trigger());
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(panel()).toBeNull());
  });
});
