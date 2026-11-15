import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useCatalogLayout } from "./catalogLayout.js";

function TestHarness() {
  const [catalogLayout, setCatalogLayout] = useCatalogLayout();
  return (
    <div>
      <span data-testid="catalog-layout">{catalogLayout}</span>
      <button onClick={() => setCatalogLayout("rail")} type="button">
        use rail
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.noteHarborDesktop;
  vi.restoreAllMocks();
});

describe("useCatalogLayout in the desktop app", () => {
  test("hydrates from the file-backed desktop preference when localStorage is empty", async () => {
    window.noteHarborDesktop = {
      getShowcaseCatalogLayout: vi.fn().mockResolvedValue("rail"),
      setShowcaseCatalogLayout: vi.fn().mockResolvedValue("rail"),
    };

    render(<TestHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("catalog-layout").textContent).toBe("rail"),
    );
    expect(
      window.noteHarborDesktop.getShowcaseCatalogLayout,
    ).toHaveBeenCalledTimes(1);
  });

  test("persists changes to the desktop preference", async () => {
    const user = userEvent.setup();
    window.noteHarborDesktop = {
      getShowcaseCatalogLayout: vi.fn().mockResolvedValue("labels"),
      setShowcaseCatalogLayout: vi.fn().mockResolvedValue("labels"),
    };

    render(<TestHarness />);
    await waitFor(() =>
      expect(
        window.noteHarborDesktop.getShowcaseCatalogLayout,
      ).toHaveBeenCalled(),
    );

    await user.click(screen.getByRole("button", { name: "use rail" }));

    await waitFor(() =>
      expect(
        window.noteHarborDesktop.setShowcaseCatalogLayout,
      ).toHaveBeenCalledWith("rail"),
    );
    expect(
      window.localStorage.getItem("noteharbor.showcaseCatalogLayout"),
    ).toBe("rail");
  });

  test("keeps working with localStorage only when no desktop bridge exists", async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    expect(screen.getByTestId("catalog-layout").textContent).toBe("labels");

    await user.click(screen.getByRole("button", { name: "use rail" }));

    await waitFor(() =>
      expect(screen.getByTestId("catalog-layout").textContent).toBe("rail"),
    );
    expect(
      window.localStorage.getItem("noteharbor.showcaseCatalogLayout"),
    ).toBe("rail");
  });
});
