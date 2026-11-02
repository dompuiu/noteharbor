import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ConnectionError } from "./ConnectionError.jsx";

function renderError(props = {}) {
  const onRetry = vi.fn();
  render(<ConnectionError onRetry={onRetry} reason="server" {...props} />);
  return { onRetry };
}

describe("ConnectionError", () => {
  test("each reason names the part that failed", () => {
    const { unmount } = render(
      <ConnectionError onRetry={vi.fn()} reason="server" />,
    );
    expect(
      screen.getByRole("heading", { name: "Can't reach the editor server." }),
    ).toBeInTheDocument();
    unmount();

    render(<ConnectionError onRetry={vi.fn()} reason="database" />);
    expect(
      screen.getByRole("heading", { name: "Can't reach the database." }),
    ).toBeInTheDocument();
  });

  test("an unknown reason falls back to the generic copy", () => {
    renderError({ reason: "unexpected" });

    expect(
      screen.getByRole("heading", { name: "Can't check the connection." }),
    ).toBeInTheDocument();
  });

  test("focus moves to the message and the alert excludes the retry button", () => {
    renderError();

    const heading = screen.getByRole("heading", {
      name: "Can't reach the editor server.",
    });
    expect(heading).toHaveFocus();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Start the editor server, then try again.");
    expect(alert).not.toContainElement(
      screen.getByRole("button", { name: "Try again" }),
    );
  });

  test("the message says the notes are unaffected", () => {
    renderError();

    expect(
      screen.getByText("Your notes stay on this device and aren't affected."),
    ).toBeInTheDocument();
  });

  test("retry reports the click", async () => {
    const { onRetry } = renderError();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("checking disables retry and announces the state", () => {
    renderError({ checking: true });

    const retry = screen.getByRole("button", { name: "Checking…" });
    expect(retry).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the connection…",
    );
  });
});
