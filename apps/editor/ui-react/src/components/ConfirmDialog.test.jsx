import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

function renderDialog(props = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      cancelLabel="Keep editing"
      confirmLabel="Discard"
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Discard changes?"
      {...props}
    />,
  );
  return { onCancel, onConfirm };
}

describe("ConfirmDialog", () => {
  test("renders the title, body, and both labels", () => {
    renderDialog({ body: "Your changes will be lost." });

    expect(
      screen.getByRole("heading", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Your changes will be lost.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep editing" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  test("the safe choice is focused by default", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
  });

  test("confirm reports the confirm choice", async () => {
    const { onCancel, onConfirm } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("cancel reports the cancel choice", async () => {
    const { onCancel, onConfirm } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("Escape abandons without confirming", async () => {
    const { onCancel, onConfirm } = renderDialog();
    const user = userEvent.setup();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("Tab keeps focus inside the dialog", async () => {
    renderDialog();
    const user = userEvent.setup();

    const cancel = screen.getByRole("button", { name: "Keep editing" });
    const confirm = screen.getByRole("button", { name: "Discard" });

    await user.tab();
    expect(confirm).toHaveFocus();

    await user.tab();
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });
});
