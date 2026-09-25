import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getOperationStatus: vi.fn(),
  reorderNotes: vi.fn(),
  getScrapeStatus: vi.fn(),
  startScrape: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 43,
        start: index * 43,
        end: (index + 1) * 43,
      })),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import {
  getNotes,
  getOperationStatus,
  getScrapeStatus,
} from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-hash">{location.hash}</output>;
}

function renderTable() {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <NotesTable
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>,
  );
}

function currentHash() {
  return screen.getByTestId("route-hash").textContent;
}

async function findRow() {
  const denomination = await screen.findByText("ZZTEST");
  return denomination.closest("tr");
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 600,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  getNotes.mockResolvedValue({
    notes: [
      {
        id: 1,
        display_order: 1,
        denomination: "ZZTEST",
        issue_date: "",
        catalog_number: "",
        grading_company: "",
        grade: "",
        serial: "",
        url: "https://example.test/note/1",
        images: [],
        tags: [],
        scrape_status: "idle",
      },
    ],
  });
  getScrapeStatus.mockResolvedValue({ status: "idle", items: [] });
  getOperationStatus.mockResolvedValue({
    currentOperation: "idle",
    isBusy: false,
  });
});

describe("NotesTable keyboard focus inside a row", () => {
  test("Enter on the focused row opens the note", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  });

  test("Enter on a nested action button runs its own action, not the row's", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    expect(row).toHaveFocus();

    const deleteButton = screen.getByRole("button", {
      name: /delete ZZTEST/i,
    });
    deleteButton.focus();
    expect(deleteButton).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(confirmSpy).toHaveBeenCalledWith("Delete ZZTEST?");
    expect(currentHash()).not.toContain("slideshow");
  });

  test("Space on the nested checkbox toggles selection instead of opening the note", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });
    checkbox.focus();

    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(currentHash()).not.toContain("slideshow");
  });
});
