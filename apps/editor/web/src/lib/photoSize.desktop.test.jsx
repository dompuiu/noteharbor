import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { usePhotoSize } from "./photoSize.js";

function TestHarness() {
  const [photoSize, setPhotoSize] = usePhotoSize();
  return (
    <div>
      <span data-testid="photo-size">{photoSize}</span>
      <button onClick={() => setPhotoSize("medium")} type="button">
        use medium
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.noteHarborDesktop;
  vi.restoreAllMocks();
});

describe("usePhotoSize in the desktop app", () => {
  test("hydrates from the file-backed desktop preference when localStorage is empty", async () => {
    // Every desktop launch is a fresh localStorage origin (random port),
    // so the remembered size must come from the main-process preference.
    window.noteHarborDesktop = {
      getShowcasePhotoSize: vi.fn().mockResolvedValue("large"),
      setShowcasePhotoSize: vi.fn().mockResolvedValue("large"),
    };

    render(<TestHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("photo-size").textContent).toBe("large"),
    );
    expect(window.noteHarborDesktop.getShowcasePhotoSize).toHaveBeenCalledTimes(1);
  });

  test("persists changes to the desktop preference", async () => {
    const user = userEvent.setup();
    window.noteHarborDesktop = {
      getShowcasePhotoSize: vi.fn().mockResolvedValue("small"),
      setShowcasePhotoSize: vi.fn().mockResolvedValue("small"),
    };

    render(<TestHarness />);
    await waitFor(() =>
      expect(window.noteHarborDesktop.getShowcasePhotoSize).toHaveBeenCalled(),
    );

    await user.click(screen.getByRole("button", { name: "use medium" }));

    await waitFor(() =>
      expect(window.noteHarborDesktop.setShowcasePhotoSize).toHaveBeenCalledWith(
        "medium",
      ),
    );
    expect(window.localStorage.getItem("noteharbor.showcasePhotoSize")).toBe(
      "medium",
    );
  });

  test("keeps working with localStorage only when no desktop bridge exists", async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    expect(screen.getByTestId("photo-size").textContent).toBe("small");

    await user.click(screen.getByRole("button", { name: "use medium" }));

    await waitFor(() =>
      expect(screen.getByTestId("photo-size").textContent).toBe("medium"),
    );
    expect(window.localStorage.getItem("noteharbor.showcasePhotoSize")).toBe(
      "medium",
    );
  });
});
