import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  deleteNote: vi.fn(),
  deleteShowcase: vi.fn(),
  getCollections: vi.fn(),
  getNotes: vi.fn(),
  getShowcases: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderNotes: vi.fn(),
  reorderShowcases: vi.fn(),
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

import { getCollections, getNotes, getShowcases } from "../lib/api.js";
import { CollectionsProvider } from "../lib/collections.jsx";
import { ShowcasesProvider } from "../lib/showcases.jsx";
import { NotesTable } from "./NotesTable.jsx";
import { Sidebar } from "./Sidebar.jsx";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Default" }],
  });
  getShowcases.mockResolvedValue({ showcases: [] });
  getNotes.mockResolvedValue({
    notes: [1, 2].map((id) => ({
      id,
      display_order: id,
      denomination: id === 1 ? "AAAA" : "BBBB",
      issue_date: "",
      catalog_number: "",
      grading_company: "",
      grade: "",
      serial: "",
      url: null,
      images: [],
      tags: [],
    })),
  });
});

test("b from a selected row clears the real selection and opens the real rail", async () => {
  const pageFocusRef = createRef();
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <CollectionsProvider>
        <ShowcasesProvider>
          <Sidebar pageFocusRef={pageFocusRef} />
          <main>
            <span ref={pageFocusRef} tabIndex={-1} />
            <NotesTable
              collection={{ id: 1, is_default: 1, name: "Default" }}
              collectionId={1}
              collections={[{ id: 1, is_default: 1, name: "Default" }]}
              collectionsError=""
              loadingCollections={false}
            />
          </main>
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );

  await screen.findByRole("link", { name: "Default" });
  const checkbox = await screen.findByRole("checkbox", { name: "Select AAAA" });
  await user.click(checkbox);
  expect(
    screen.getByRole("region", { name: "Selection actions" }),
  ).toBeInTheDocument();

  checkbox.focus();
  await user.keyboard("{b}");

  await waitFor(() => {
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
  });
  expect(checkbox).not.toBeChecked();
  expect(document.activeElement).toHaveTextContent("Default");
});
