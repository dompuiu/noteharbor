import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  LAST_VISITED_ROUTE_STORAGE_KEY,
  LastVisitedRouteSync,
} from "./lastVisitedRoute.js";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

function renderWithSync(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LastVisitedRouteSync />
      <Routes>
        <Route element={<LocationProbe />} path="*" />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.noteHarborDesktop;
  vi.restoreAllMocks();
});

describe("LastVisitedRouteSync in the desktop app", () => {
  test("persists page changes to localStorage and the desktop preference", async () => {
    const setLastVisitedRoute = vi
      .fn()
      .mockResolvedValue("/catalog/collections/1/view");
    window.noteHarborDesktop = {
      getLastVisitedRoute: vi.fn().mockResolvedValue(null),
      setLastVisitedRoute,
    };

    renderWithSync(["/catalog/collections/1/view"]);

    await waitFor(() =>
      expect(
        window.localStorage.getItem(LAST_VISITED_ROUTE_STORAGE_KEY),
      ).toBe("/catalog/collections/1/view"),
    );
    await waitFor(() =>
      expect(setLastVisitedRoute).toHaveBeenCalledWith(
        "/catalog/collections/1/view",
      ),
    );
  });

  test("restores the remembered page when booting on /", async () => {
    window.noteHarborDesktop = {
      getLastVisitedRoute: vi
        .fn()
        .mockResolvedValue("/catalog/import-export"),
      setLastVisitedRoute: vi.fn().mockResolvedValue(null),
    };

    renderWithSync(["/"]);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/catalog/import-export",
      ),
    );
    expect(
      window.noteHarborDesktop.getLastVisitedRoute,
    ).toHaveBeenCalledTimes(1);
  });

  test("restores from localStorage when no desktop bridge exists", async () => {
    window.localStorage.setItem(
      LAST_VISITED_ROUTE_STORAGE_KEY,
      "/portfolio/showcases/2/view",
    );

    renderWithSync(["/"]);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/portfolio/showcases/2/view",
      ),
    );
  });

  test("stays on / without a remembered page", async () => {
    renderWithSync(["/"]);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/"),
    );
  });
});
