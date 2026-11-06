import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Toast, ToastHost, TOAST_DURATION_MS } from "./Toast.jsx";

afterEach(() => {
  vi.useRealTimers();
});

describe("toast presentation", () => {
  test("a confirmation is a polite status card with its tone's class", () => {
    render(<Toast>Tags updated on 2 notes</Toast>);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Tags updated on 2 notes");
    expect(toast).toHaveClass("toast", "toast--success");
  });

  test("a failure is an assertive alert card", () => {
    render(<Toast tone="danger">Could not save the note.</Toast>);

    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Could not save the note.");
    expect(toast).toHaveClass("toast", "toast--danger");
  });
});

describe("toast host", () => {
  test("shows the message and tone it is handed, then clears itself", () => {
    vi.useFakeTimers();
    const toastRef = createRef();
    render(<ToastHost toastRef={toastRef} />);

    act(() => {
      toastRef.current.show("Could not delete the notes.", "danger");
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not delete the notes.",
    );

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // A replacement message restarts the clock instead of stacking cards.
  test("a second message replaces the first and restarts its timer", () => {
    vi.useFakeTimers();
    const toastRef = createRef();
    render(<ToastHost toastRef={toastRef} />);

    act(() => {
      toastRef.current.show("Moved to Other.");
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1000);
      toastRef.current.show("Tags updated on 2 notes", "success");
    });

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tags updated on 2 notes",
    );

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1000);
    });

    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
