import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  deleteShowcase: vi.fn(),
  getCollections: vi.fn(),
  getShowcases: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
}));

import {
  createCollection,
  createShowcase,
  getCollections,
  getShowcases,
  reorderCollections,
  reorderShowcases,
} from "../lib/api.js";
import { CollectionsProvider } from "../lib/collections.jsx";
import { sidebarPinStorageKey } from "../lib/sidebarPin.js";
import { ShowcasesProvider } from "../lib/showcases.jsx";
import { APP_VERSION } from "../lib/version.js";
import { Sidebar } from "./Sidebar.jsx";
import { ToastProvider } from "./Toast.jsx";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  SHOWCASE_ROUTES,
} from "../lib/routes.js";

// The sidebar's destinations: one link per loaded collection, then
// Import / Export, plus one link per loaded showcase. The `+ New collection`
// and `+ New showcase` rows are buttons, not links, so they are asserted
// separately.
const LINKS = [
  "All notes",
  "Default",
  "Archive",
  "Import / Export",
  "Summer",
  "Vienna",
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

// Mirrors App's shell: the sidebar sits beside a main region whose first
// child is the inert focus anchor that Escape hands focus to.
async function renderSidebar(path) {
  const pageFocusRef = createRef();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <ToastProvider>
        <CollectionsProvider>
          <ShowcasesProvider>
            <Sidebar pageFocusRef={pageFocusRef} />
          </ShowcasesProvider>
        </CollectionsProvider>
        <main>
          <span
            className="page-focus-anchor"
            data-testid="page-anchor"
            ref={pageFocusRef}
            tabIndex={-1}
          />
        </main>
      </ToastProvider>
    </MemoryRouter>,
  );

  // Wait for the data-driven rows before interacting.
  await screen.findByRole("link", { name: "Summer" });
  await screen.findByRole("link", { name: "Default" });
  return { ...view, pageFocusRef };
}

function newShowcaseButton() {
  return screen.getByRole("button", { name: "New showcase" });
}

function newCollectionButton() {
  return screen.getByRole("button", { name: "New collection" });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations; a rejected reorder set by one test
  // must not outlive it.
  reorderCollections.mockReset();
  reorderShowcases.mockReset();
  window.localStorage.clear();
  getShowcases.mockResolvedValue({
    showcases: [
      { id: 1, name: "Summer", note_count: 7 },
      { id: 2, name: "Vienna" },
    ],
  });
  createShowcase.mockResolvedValue({
    showcase: { id: 9, name: "Showcase" },
  });
  getCollections.mockResolvedValue({
    collections: [
      { id: 1, is_default: 1, name: "Default", note_count: 2 },
      { id: 2, is_default: 0, name: "Archive", note_count: 0 },
    ],
  });
  createCollection.mockResolvedValue({
    collection: { id: 9, is_default: 0, name: "Collection" },
  });
});

describe("Sidebar navigation groups", () => {
  test("exposes a labelled navigation landmark", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  test("renders one link and one icon per destination", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    for (const label of LINKS) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(1);
    }

    // Every destination and create action carries its own icon; the grip is
    // an extra icon in reorderable rows, not a replacement.
    expect(
      container.querySelectorAll(".sidebar-link .sidebar-ic:not(.sidebar-ic--grip) svg"),
    ).toHaveLength(LINKS.length + 2);
    expect(newCollectionButton()).toBeInTheDocument();
    expect(newShowcaseButton()).toBeInTheDocument();
  });

  test("gives each category a marker icon beside its name", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Two section markers, one per category, kept out of the link list so a
    // category never reads as a destination.
    const markers = container.querySelectorAll(
      ".sidebar-group-label .sidebar-group-ic svg",
    );
    expect(markers).toHaveLength(2);
    expect(container.querySelectorAll(".sidebar-link .sidebar-group-ic"))
      .toHaveLength(0);

    const catalogLabel = container.querySelector("#sidebar-group-catalog");
    expect(catalogLabel).toHaveTextContent("Catalog");
    expect(catalogLabel.querySelector(".sidebar-group-ic svg")).not.toBeNull();

    const showcasesLabel = container.querySelector("#sidebar-group-showcases");
    expect(showcasesLabel).toHaveTextContent("Showcases");
    expect(showcasesLabel.querySelector(".sidebar-group-ic svg")).not.toBeNull();
  });

  test("the collections home is the default route", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(DEFAULT_DESTINATION).toBe(CATALOG_ROUTES.collections);
  });

  test("marks the open collection as the current page", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(2));

    expect(
      screen.getByRole("link", { name: "Archive" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("highlights the open collection in edit mode too", async () => {
    await renderSidebar(CATALOG_ROUTES.collectionEdit(2));

    expect(
      screen.getByRole("link", { name: "Archive" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("marks no collection current while the note editor is open", async () => {
    await renderSidebar(CATALOG_ROUTES.noteEdit(7));

    // The note editor URL names no collection, so no row claims it.
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("puts All notes first in Catalog and marks it current only on its route", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.allNotes);

    const allNotes = screen.getByRole("link", { name: "All notes" });
    expect(allNotes).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).not.toHaveAttribute("aria-current");
    expect(collectionLabels(container)[0]).toBe("All notes");
  });

  test("highlights the open showcase, in view and edit mode", async () => {
    await renderSidebar(SHOWCASE_ROUTES.showcase(2));

    expect(
      screen.getByRole("link", { name: "Vienna" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Summer" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("links navigate to the prefixed destinations", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("link", { name: "Import / Export" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.importExport,
    );
  });

  test("`+ New showcase` stages a draft without posting and opens its edit route", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newShowcaseButton());

    // Deferred creation: nothing POSTs until Save.
    expect(createShowcase).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        SHOWCASE_ROUTES.showcaseEdit("new"),
      );
    });
    // The draft is visible in the sidebar while it is pending.
    const draft = screen.getByRole("link", {
      name: "Unsaved showcase: Showcase",
    });
    expect(draft).toHaveClass("sidebar-link--pending");
    expect(draft).toHaveAttribute("title", "Showcase");
  });

  test("leaving the draft route discards the pending showcase", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newShowcaseButton());
    await screen.findByRole("link", { name: "Unsaved showcase: Showcase" });

    await user.click(screen.getByRole("link", { name: "Default" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Unsaved showcase: Showcase" })).not.toBeInTheDocument();
    });
    // The row does not disappear wordlessly.
    expect(await screen.findByText("Showcase draft discarded.")).toBeInTheDocument();
    expect(createShowcase).not.toHaveBeenCalled();
  });

  test("a link click moves focus into the page, off the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("link", { name: "Archive" }));

    // The rail is collapsed after the click, so focus belongs in the page.
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("renders the app version pinned at the bottom of the sidebar", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Display-only footer: centered text, not a link or button, so it never
    // joins the keyboard cursor stops.
    const version = screen.getByText(`v${APP_VERSION}`);
    expect(version).toBeInTheDocument();
    expect(version.classList.contains("sidebar-version")).toBe(true);
    expect(version.closest("#app-sidebar")).not.toBeNull();
    expect(version.closest(".sidebar-foot")).not.toBeNull();
    expect(version.tagName).toBe("SPAN");
    expect(container.querySelector(".sidebar-foot")).toBeInTheDocument();
    // The footer sits after the scrolling nav, so it stays pinned bottom.
    const nav = container.querySelector("#app-sidebar");
    expect(nav.lastElementChild.classList.contains("sidebar-foot")).toBe(true);
  });

  test("after a link click, an arrow key does not reopen the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Reproduces the report: click a destination, then press ↓. Focus is now
    // in the page, so the sidebar must not claim the key and open its cursor.
    await user.click(screen.getByRole("link", { name: "Archive" }));
    await user.keyboard("{ArrowDown}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

describe("Sidebar collapsed identity", () => {
  test("collection and showcase rows show their note count under the glyph", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Default (2), Archive (0), Summer (7), then Vienna, whose fixture carries
    // no count and so falls back to its initials. All notes, Import / Export
    // and the create actions stay plain icons.
    const marks = [...container.querySelectorAll(".sidebar-link-mark")];
    expect(marks.map((mark) => mark.textContent)).toEqual([
      "2",
      "0",
      "7",
      "VI",
    ]);

    // The mark is decoration: the link's accessible name stays the name.
    for (const mark of marks) {
      expect(mark).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).toBeInTheDocument();
  });

  test("a row without a loaded count falls back to two-character initials", async () => {
    getCollections.mockResolvedValue({
      collections: [
        { id: 1, is_default: 1, name: "Default", note_count: null },
        { id: 2, is_default: 0, name: "Summer Postcards", note_count: "4" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const catalog = container.querySelector(
      '.sidebar-group[aria-labelledby="sidebar-group-catalog"]',
    );
    const marks = [...catalog.querySelectorAll(".sidebar-link-mark")];
    expect(marks.map((mark) => mark.textContent)).toEqual(["DE", "SP"]);
  });
});

describe("Sidebar pin", () => {
  test("pins the rail open and remembers it across reloads", async () => {
    const user = userEvent.setup();
    const { container, unmount } = await renderSidebar(
      CATALOG_ROUTES.collection(1),
    );

    expect(container.querySelector(".sidebar-dock--pinned")).toBeNull();
    const pin = screen.getByRole("button", { name: "Pin sidebar" });
    expect(pin).toHaveAttribute("aria-pressed", "false");

    await user.click(pin);

    expect(
      screen.getByRole("button", { name: "Pin sidebar" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".sidebar-dock--pinned")).not.toBeNull();
    expect(window.localStorage.getItem(sidebarPinStorageKey)).toBe(
      "true",
    );

    unmount();

    const reloaded = await renderSidebar(CATALOG_ROUTES.collection(1));
    expect(
      reloaded.container.querySelector(".sidebar-dock--pinned"),
    ).not.toBeNull();
  });

  test("unpinning returns the rail to hover and focus expansion", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(sidebarPinStorageKey, "true");
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Pin sidebar" }));

    expect(container.querySelector(".sidebar-dock--pinned")).toBeNull();
    expect(window.localStorage.getItem(sidebarPinStorageKey)).toBe(
      "false",
    );
  });

  test("restoring the pin does not move keyboard focus", async () => {
    window.localStorage.setItem(sidebarPinStorageKey, "true");
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(
      screen.getByRole("button", { name: "Pin sidebar" }),
    ).not.toHaveFocus();
  });

  test("the pin is a keyboard cursor stop that toggles on Enter", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );
    expect(
      document.activeElement.classList.contains("sidebar-pin--cursor"),
    ).toBe(true);

    await user.keyboard("{Enter}");

    expect(container.querySelector(".sidebar-dock--pinned")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Pin sidebar" }),
    ).toHaveAttribute("aria-pressed", "true");

    // A second Enter reads the new state, not the one the listener captured.
    await user.keyboard("{Enter}");
    expect(container.querySelector(".sidebar-dock--pinned")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pin sidebar" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a pinned rail shows saved rows and their grips without hover", async () => {
    window.localStorage.setItem(sidebarPinStorageKey, "true");
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(container.querySelector(".sidebar-dock--pinned")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Default" }).closest(".sidebar-row"),
    ).not.toBeNull();
    expect(document.querySelectorAll(".sidebar-ic--grip")).toHaveLength(4);
  });
});

describe("Sidebar keyboard cursor", () => {
  test("`b` opens the rail on the active option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(2));

    await user.keyboard("{b}");

    expect(
      screen
        .getByRole("link", { name: "Archive" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(true);
    expect(document.activeElement).toHaveTextContent("Archive");
  });

  test("`/` is left for the table filter, not the sidebar", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // `/` stays with the table filter; firing it must not open the rail.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "/" }),
    );

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("j/k and arrows move the cursor between options", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default (first collection)
    await user.keyboard("{j}"); // Archive
    expect(document.activeElement).toHaveTextContent("Archive");

    await user.keyboard("{k}"); // back to Default
    expect(document.activeElement).toHaveTextContent("Default");
  });

  test("Home and End jump to the ends", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );
  });

  test("Enter follows the focused option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default
    await user.keyboard("{j}"); // Archive
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.collection(2),
    );
  });

  test("Escape clears the cursor and returns control to the page", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("navigation"));
  });

  test("the dock holds the open class while the cursor is active", async () => {
    // The open class is React-owned, so it cannot flicker between key
    // presses the way `:has(:focus-visible)` can: the labels keep one
    // steady computed style while navigating and never replay their
    // entrance.
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(container.querySelector(".sidebar-dock--open")).toBeNull();

    await user.keyboard("{b}");
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();

    // Moving the cursor must not drop the class for a render.
    await user.keyboard("{ArrowDown}");
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(container.querySelector(".sidebar-dock--open")).toBeNull();
  });

  test("Tab off the last option wraps to the first, like ArrowDown", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Tab}");

    // Tab stays in the rail and wraps, matching ArrowDown. The first stop is
    // now the pin in the head.
    expect(
      container.querySelector(
        ".sidebar-link--cursor, .sidebar-pin--cursor",
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );
  });

  test("Shift+Tab off the first option wraps to the last, like ArrowUp", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(
      container.querySelector(
        ".sidebar-link--cursor, .sidebar-pin--cursor",
      ),
    ).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("New showcase");
  });

  test("arrows walk every stop in DOM order and wrap off the ends", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    // "b" lands on the active row link; one step back is All notes, then the
    // sequence wraps to the last stop because no group toggle interrupts it.
    expect(document.activeElement).toHaveTextContent("Default");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveTextContent("All notes");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );

    // One more step off the first stop wraps to the last.
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Pin sidebar" }),
    );
  });

  test("Shift+↑/↓ jumps the focused row to either end of its group", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    await renderSidebar(CATALOG_ROUTES.collection(2));

    await user.keyboard("{b}"); // Archive
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Archive" })).toHaveFocus();
    });
  });

  test("Shift+↑/↓ works from a row focused with Tab", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    await renderSidebar(CATALOG_ROUTES.collection(1));

    // No "b": native Tab focus on the row is enough for the accelerator.
    screen.getByRole("link", { name: "Default" }).focus();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Default" })).toHaveFocus();
    });
  });

  test("Shift+↑/↓ does nothing on a row that cannot reorder", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default
    await user.keyboard("{ArrowUp}"); // All notes
    expect(document.activeElement).toHaveTextContent("All notes");

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(reorderCollections).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveTextContent("All notes");
  });

  test("Tab keeps its native order until the cursor is active", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // No "b": a plain Tab through the rail must not be captured or wrap.
    // All notes has no move buttons, so the next stop is the Default link.
    screen.getByRole("link", { name: "All notes" }).focus();
    await user.keyboard("{Tab}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
  });

  test("`b` opens the rail from any focusable control", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // "b" is global: a focused button does not own the letter.
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    outside.remove();
  });

  test("`b` opens the rail while a table row has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // The notes table's rows are focusable <tr>s inside the table shell. The
    // row is the keyboard cursor, not a control that consumes text, so "b"
    // must reach the rail exactly as it does with no row focused.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML =
      '<table><tbody><tr class="table-row-link" tabindex="0"></tr></tbody></table>';
    document.body.append(shell);
    const row = shell.querySelector("tr");
    row.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    shell.remove();
  });

  test("`b` opens the rail from a control inside a table row", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // The selection actions bar and a row's own actions button are focusable
    // controls, but "b" is still global and reaches the rail.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML =
      '<table><tbody><tr class="table-row-link" tabindex="0"><td><button type="button">Actions</button></td></tr></tbody></table>';
    document.body.append(shell);
    const button = shell.querySelector("button");
    button.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    shell.remove();
  });

  test("`b` does nothing while a text field has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // A text field needs the letter for typing, so it keeps "b" even though
    // the shortcut is otherwise global.
    const field = document.createElement("input");
    field.type = "text";
    document.body.append(field);
    field.focus();
    await user.keyboard("{b}");

    expect(field).toHaveValue("b");
    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    field.remove();
  });

  test("`b` does nothing while a dialog has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Dialogs own their keys until dismissed.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = "<button type='button'>Confirm</button>";
    document.body.append(dialog);
    const button = dialog.querySelector("button");
    button.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(button);
    dialog.remove();
  });

  test("`b` does nothing while an alert dialog has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    dialog.innerHTML = "<button type='button'>Cancel</button>";
    document.body.append(dialog);
    const button = dialog.querySelector("button");
    button.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(button);
    dialog.remove();
  });

  test("`b` does nothing inside the note editor overlay", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // The Note editor is a full-screen overlay, not a role="dialog", but it
    // owns its keys until closed.
    const overlay = document.createElement("section");
    overlay.className = "edit-note-overlay";
    overlay.innerHTML = "<button type='button'>Save</button>";
    document.body.append(overlay);
    const button = overlay.querySelector("button");
    button.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(button);
    overlay.remove();
  });

  test("`b` does nothing inside the note slideshow", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const slideshow = document.createElement("div");
    slideshow.className = "slideshow-screen--overlay";
    slideshow.innerHTML = "<button type='button'>Close</button>";
    document.body.append(slideshow);
    const button = slideshow.querySelector("button");
    button.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(button);
    slideshow.remove();
  });

  test("`b` opens the rail from a checkbox outside a table", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // A checkbox holds no text, so it keeps the global shortcut too.
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(checkbox);
    checkbox.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    checkbox.remove();
  });

  test("`b` opens the rail when a table row checkbox has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // A row checkbox holds no text, so "b" must still open the rail even
    // though the control sits inside the table.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML =
      '<table><tbody><tr class="table-row-link"><td><input type="checkbox" aria-label="Select note"></td></tr></tbody></table>';
    document.body.append(shell);
    const checkbox = shell.querySelector("input");
    checkbox.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    shell.remove();
  });

  test("`b` opens the rail when focus rests on the table's empty-row anchor", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Pressing Escape on a focused row parks focus on an inert anchor inside
    // the table shell. Visually nothing is focused, so "b" must still open
    // the rail exactly as it does on a fresh page load.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML = '<span class="table-focus-anchor" tabindex="-1"></span>';
    document.body.append(shell);
    const anchor = shell.querySelector(".table-focus-anchor");
    anchor.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    shell.remove();
  });

  test("Escape returns focus off the rail, not onto a hidden link", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{Escape}");

    expect(document.activeElement).not.toBe(
      screen.getByRole("navigation", { name: "Sections" }),
    );
    expect(
      screen
        .getByRole("link", { name: "Default" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(false);
  });

  test("Escape returns focus to the control that opened the rail", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    const origin = document.createElement("button");
    origin.textContent = "Row";
    document.body.append(origin);
    origin.focus();

    await user.keyboard("{b}");
    expect(document.activeElement).toHaveTextContent("Default");

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });

  test("Escape hands focus to the page content", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.importExport);

    await user.keyboard("{b}");
    expect(document.activeElement).toHaveTextContent("Import / Export");

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

function dragEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function makeDataTransfer() {
  return {
    effectAllowed: "",
    setData: vi.fn(),
    setDragImage: vi.fn(),
    getData: vi.fn(() => ""),
  };
}

function showcaseLabels(container) {
  return Array.from(
    container.querySelectorAll(
      '.sidebar-group[aria-labelledby="sidebar-group-showcases"] .sidebar-link-label',
    ),
    (element) => element.textContent,
  );
}

function collectionLabels(container) {
  return Array.from(
    container.querySelectorAll(
      '.sidebar-group[aria-labelledby="sidebar-group-catalog"] .sidebar-link-label',
    ),
    (element) => element.textContent,
  );
}

describe("Sidebar collection rows", () => {
  test("`+ New collection` stages a draft without posting and opens its edit route", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newCollectionButton());

    // Deferred creation: nothing POSTs until Save.
    expect(createCollection).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        CATALOG_ROUTES.collectionEdit("new"),
      );
    });
    // The draft is visible in the sidebar while it is pending, above Import.
    const draft = screen.getByRole("link", {
      name: "Unsaved collection: Collection",
    });
    expect(draft).toHaveClass("sidebar-link--pending");
    expect(draft).toHaveAttribute("title", "Collection");
    const { container } = { container: document.querySelector(".sidebar-nav") };
    expect(collectionLabels(container)).toEqual([
      "All notes",
      "Default",
      "Archive",
      "Collection",
      "New collection",
      "Import / Export",
    ]);
  });

  test("leaving the draft route discards the pending collection", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newCollectionButton());
    await screen.findByRole("link", { name: "Unsaved collection: Collection" });

    await user.click(screen.getByRole("link", { name: "Default" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Unsaved collection: Collection" })).not.toBeInTheDocument();
    });
    // The row does not disappear wordlessly.
    expect(await screen.findByText("Collection draft discarded.")).toBeInTheDocument();
    expect(createCollection).not.toHaveBeenCalled();
  });
});

describe("Sidebar collection reordering", () => {
  test("saved rows are always draggable and grow a grip without a toggle", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Reordering has no mode: no per-group toggle exists.
    expect(
      screen.queryByRole("button", { name: /^Reorder (Catalog|Showcases)$/ }),
    ).not.toBeInTheDocument();

    // A saved collection row is the draggable unit; its name stays a link.
    const row = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("draggable", "true");
    expect(
      screen.getByRole("link", { name: "Default" }).getAttribute("draggable"),
    ).toBe("false");

    // `All notes` is a destination, not a collection: no wrapper, no grip.
    expect(
      screen.getByRole("link", { name: "All notes" }).closest(".sidebar-row"),
    ).toBeNull();

    const catalogGroup = container.querySelector(
      '.sidebar-group[aria-labelledby="sidebar-group-catalog"]',
    );
    expect(catalogGroup.querySelectorAll(".sidebar-ic--grip")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Move Default up" }),
    ).toBeInTheDocument();
  });

  test("a pending collection draft is never draggable or a drop target", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newCollectionButton());
    const draft = await screen.findByRole("link", { name: "Unsaved collection: Collection" });

    expect(draft.closest(".sidebar-row")).toBeNull();
    expect(draft.getAttribute("draggable")).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Move Collection up" }),
    ).not.toBeInTheDocument();
    expect(
      container
        .querySelector('.sidebar-group[aria-labelledby="sidebar-group-catalog"]')
        .querySelectorAll(".sidebar-ic--grip"),
    ).toHaveLength(2);
  });

  test("a very long name keeps its full text in the title while it truncates", async () => {
    const longName = `${"Showcase ".repeat(20).trim()}`;
    getCollections.mockResolvedValue({
      collections: [
        { id: 1, is_default: 1, name: longName, note_count: 0 },
        { id: 2, is_default: 0, name: "Default", note_count: 0 },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // The visible label truncates via CSS; the full name survives on hover.
    const link = screen.getByRole("link", { name: longName });
    expect(link).toHaveAttribute("title", longName);

    const row = link.closest(".sidebar-row");
    expect(row).not.toBeNull();
    expect(row.querySelector(".sidebar-link-label")).toHaveTextContent(longName);
    expect(container.querySelector(".sidebar-nav")).toBeInTheDocument();
  });

  test("grips take the icon slot so every icon shares one column", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Every reorderable row carries both the item icon and the grip; CSS
    // shows one or the other in the same 22px box, so nothing shifts.
    const catalogGroup = container.querySelector(
      '.sidebar-group[aria-labelledby="sidebar-group-catalog"]',
    );
    expect(catalogGroup.querySelectorAll(".sidebar-row")).toHaveLength(2);
    for (const row of catalogGroup.querySelectorAll(".sidebar-row")) {
      expect(row.querySelector(".sidebar-ic--item")).not.toBeNull();
      expect(row.querySelector(".sidebar-ic--grip")).not.toBeNull();
    }
    // Plain rows keep their own icons and gain no wrapper or slot.
    expect(
      screen.getByRole("button", { name: "New collection" }).closest(".sidebar-row"),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Import / Export" }).closest(".sidebar-row"),
    ).toBeNull();
  });

  test("the pointer leaving the rail does not end a drag", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));
    const defaultRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");

    await act(async () => {
      defaultRow.dispatchEvent(
        dragEvent("dragstart", { dataTransfer: makeDataTransfer() }),
      );
    });

    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(true);
    // The dock holds the open layout for the whole gesture, so the drop
    // targets and grips never vanish under the pointer.
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();

    // Dispatched natively — it does not bubble, so only a real dock exit
    // delivers it, with the true outside target attached.
    await act(async () => {
      container.querySelector(".sidebar-dock").dispatchEvent(
        new MouseEvent("mouseleave", { relatedTarget: document.body }),
      );
    });

    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(true);
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();
  });

  test("blur does not end a drag", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));
    const defaultRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");

    await act(async () => {
      defaultRow.dispatchEvent(
        dragEvent("dragstart", { dataTransfer: makeDataTransfer() }),
      );
    });

    // Focus moves out to the page, as a click on the table would do.
    await act(async () => {
      screen.getByTestId("page-anchor").focus();
    });

    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(true);
    expect(container.querySelector(".sidebar-dock--open")).not.toBeNull();
  });

  test("Escape ends an active drag but keeps the rail usable", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));
    const defaultRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");

    await act(async () => {
      defaultRow.dispatchEvent(
        dragEvent("dragstart", { dataTransfer: makeDataTransfer() }),
      );
    });
    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(true);

    await user.keyboard("{Escape}");

    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(false);
    expect(container.querySelector(".sidebar-dock--open")).toBeNull();
    // A drag with no keyboard cursor must not eject focus onto the page.
    expect(document.activeElement).not.toBe(screen.getByTestId("page-anchor"));
    expect(reorderCollections).not.toHaveBeenCalled();
  });

  test("a click outside the rail ends an active drag", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));
    const defaultRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");

    await act(async () => {
      defaultRow.dispatchEvent(
        dragEvent("dragstart", { dataTransfer: makeDataTransfer() }),
      );
    });

    await act(async () => {
      document.body.dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });

    expect(defaultRow.classList.contains("sidebar-row--dragging")).toBe(false);
    expect(container.querySelector(".sidebar-dock--open")).toBeNull();
  });

  test("the first row cannot move up and the last cannot move down", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(
      screen.getByRole("button", { name: "Move Default up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Archive down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Default down" }),
    ).not.toBeDisabled();
  });

  test("the move buttons hand the provider the swapped order", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Archive up" }));

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(collectionLabels(container)).toEqual([
        "All notes",
        "Archive",
        "Default",
        "New collection",
        "Import / Export",
      ]);
    });
  });

  test("a second reorder is ignored while a request is in flight", async () => {
    const user = userEvent.setup();
    let resolveReorder;
    reorderCollections.mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Archive up" }));
    await user.click(screen.getByRole("button", { name: "Move Default down" }));

    expect(reorderCollections).toHaveBeenCalledTimes(1);
    expect(reorderCollections).toHaveBeenCalledWith([2, 1]);

    await act(async () => {
      resolveReorder({
        collections: [
          { id: 2, is_default: 0, name: "Archive" },
          { id: 1, is_default: 1, name: "Default" },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Archive" })).toBeInTheDocument();
    });
  });

  test("Shift+↓ jumps the focused row to the bottom of the group", async () => {
    const user = userEvent.setup();
    getCollections.mockResolvedValue({
      collections: [
        { id: 1, is_default: 1, name: "Default", note_count: 2 },
        { id: 2, is_default: 0, name: "Archive", note_count: 0 },
        { id: 3, is_default: 0, name: "Winter", note_count: 4 },
      ],
    });
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive", note_count: 0 },
        { id: 3, is_default: 0, name: "Winter", note_count: 4 },
        { id: 1, is_default: 1, name: "Default", note_count: 2 },
      ],
    });
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 3, 1]);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Default" })).toHaveFocus();
    });
  });

  test("dropping one collection onto another hands the provider the new order", async () => {
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const defRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");
    const archiveRow = screen
      .getByRole("link", { name: "Archive" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      defRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      archiveRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      archiveRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(collectionLabels(container)).toEqual([
        "All notes",
        "Archive",
        "Default",
        "New collection",
        "Import / Export",
      ]);
    });
  });

  test("a failed reorder leaves the visible order untouched", async () => {
    reorderCollections.mockRejectedValue(new Error("offline"));
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const defRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");
    const archiveRow = screen
      .getByRole("link", { name: "Archive" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      defRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      archiveRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalled();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save the new order — it was restored.",
    );
    expect(collectionLabels(container)).toEqual([
      "All notes",
      "Default",
      "Archive",
      "New collection",
      "Import / Export",
    ]);
  });
});

describe("Sidebar showcase reordering", () => {
  test("dropping one showcase onto another hands the provider the new order", async () => {
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const summerRow = screen
      .getByRole("link", { name: "Summer" })
      .closest(".sidebar-row");
    const viennaRow = screen
      .getByRole("link", { name: "Vienna" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summerRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      viennaRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      viennaRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    await waitFor(() => {
      expect(reorderShowcases).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(showcaseLabels(container)).toEqual([
        "Vienna",
        "Summer",
        "New showcase",
      ]);
    });
  });

  test("the move buttons hand the provider the swapped order", async () => {
    const user = userEvent.setup();
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Vienna up" }));

    await waitFor(() => {
      expect(reorderShowcases).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(showcaseLabels(container)).toEqual([
        "Vienna",
        "Summer",
        "New showcase",
      ]);
    });
  });

  test("a drop that lands a showcase back where it started persists nothing", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const summerRow = screen
      .getByRole("link", { name: "Summer" })
      .closest(".sidebar-row");
    const viennaRow = screen
      .getByRole("link", { name: "Vienna" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summerRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      // A negative clientY is above the (all-zero) rect midpoint, so the
      // placement is "before" — Summer stays immediately ahead of Vienna.
      viennaRow.dispatchEvent(
        dragEvent("dragover", { clientY: -5, dataTransfer }),
      );
    });
    await act(async () => {
      viennaRow.dispatchEvent(dragEvent("drop", { clientY: -5, dataTransfer }));
    });

    expect(reorderShowcases).not.toHaveBeenCalled();
    expect(showcaseLabels(container)).toEqual([
      "Summer",
      "Vienna",
      "New showcase",
    ]);
    // Nothing was asked of the server, so nothing is reported.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector(".toast")).toBeNull();
  });

  test("a pending showcase draft is never draggable", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newShowcaseButton());
    const draft = await screen.findByRole("link", { name: "Unsaved showcase: Showcase" });

    expect(draft.closest(".sidebar-row")).toBeNull();
    expect(draft.getAttribute("draggable")).toBe("false");
  });
});

describe("Sidebar reorder failures", () => {
  const FAILURE = "Couldn't save the new order — it was restored.";

  test("a failed move reports it and returns focus to the row", async () => {
    const user = userEvent.setup();
    reorderCollections.mockRejectedValue(
      new Error("The server is unreachable."),
    );
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Default down" }));

    // One failed request, one message (findByRole refuses a second match),
    // and focus lands on the moved row's link rather than a dead button.
    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Default" })).toHaveFocus();
    });
    expect(collectionLabels(container)).toEqual([
      "All notes",
      "Default",
      "Archive",
      "New collection",
      "Import / Export",
    ]);
  });

  test("a failed Shift+↑/↓ jump reports it and keeps focus on the row", async () => {
    const user = userEvent.setup();
    reorderCollections.mockRejectedValue(
      new Error("The server is unreachable."),
    );
    await renderSidebar(CATALOG_ROUTES.collection(2));

    await user.keyboard("{b}"); // Archive
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Archive" })).toHaveFocus();
    });
  });

  test("a failed showcase drop reports it and returns focus to the row", async () => {
    reorderShowcases.mockRejectedValue(
      new Error("The server is unreachable."),
    );
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const summerRow = screen
      .getByRole("link", { name: "Summer" })
      .closest(".sidebar-row");
    const viennaRow = screen
      .getByRole("link", { name: "Vienna" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summerRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      viennaRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      viennaRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Summer" })).toHaveFocus();
    });
    expect(showcaseLabels(container)).toEqual([
      "Summer",
      "Vienna",
      "New showcase",
    ]);
  });

  test("a late failure leaves focus where the collector moved it", async () => {
    let rejectMove;
    reorderCollections.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectMove = reject;
        }),
    );
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    const defRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");
    const archiveRow = screen
      .getByRole("link", { name: "Archive" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      defRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      archiveRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      archiveRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    // The request hangs; the collector moves on to the page. The rejection
    // must report without yanking focus back into the rail.
    screen.getByTestId("page-anchor").focus();
    await act(async () => {
      rejectMove(new Error("The server is unreachable."));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
    expect(screen.getByTestId("page-anchor")).toHaveFocus();
    expect(collectionLabels(container)).toEqual([
      "All notes",
      "Default",
      "Archive",
      "New collection",
      "Import / Export",
    ]);
  });

  test("a reorder skipped while one is in flight reports nothing", async () => {
    const user = userEvent.setup();
    let rejectMove;
    reorderCollections.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectMove = reject;
        }),
    );
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Archive up" }));
    // The first request is still in flight, so this second move is skipped
    // and must not report a failure of its own.
    await user.click(screen.getByRole("button", { name: "Move Default down" }));

    expect(reorderCollections).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectMove(new Error("The server is unreachable."));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILURE);
    expect(reorderCollections).toHaveBeenCalledTimes(1);
  });

  test("a successful move raises no message", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Move Archive up" }));

    await waitFor(() => {
      expect(collectionLabels(container)).toEqual([
        "All notes",
        "Archive",
        "Default",
        "New collection",
        "Import / Export",
      ]);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The LocationProbe's <output> is the only status role here; no toast
    // card joined it.
    expect(container.querySelector(".toast")).toBeNull();
  });
});

