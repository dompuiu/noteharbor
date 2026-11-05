import { MemoryRouter } from "react-router-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseFilterField } from "../test/filterBar.js";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
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
  reorderNotes,
} from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, denomination) {
  return {
    id,
    display_order: id,
    denomination,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
  };
}

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

function bounds(top, bottom) {
  return {
    width: 1000,
    height: bottom - top,
    top,
    bottom,
    left: 0,
    right: 1000,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function renderTable() {
  return render(
    <MemoryRouter>
      <NotesTable
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
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
  getNotes.mockResolvedValue({
    notes: [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")],
  });
  reorderNotes.mockResolvedValue({ notes: [] });
});

function rowFor(container, denomination) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  ).find((row) => row.textContent.includes(denomination));
}

function rowDenominations(container) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  ).map((row) => row.textContent.match(/[A-E]{4}/)?.[0] ?? "");
}

async function focusRow(container, denomination) {
  const row = rowFor(container, denomination);

  expect(row).toBeTruthy();
  await act(async () => {
    row.focus();
  });
  return row;
}

// The server echoes the reordered notes back in these tests, so the rows stay
// mounted and focus can follow the moved row.
function echoReorderedNotes(notes) {
  const byId = new Map(notes.map((item) => [item.id, item]));

  reorderNotes.mockImplementation((ids) =>
    Promise.resolve({
      notes: ids.map((id, index) => ({
        ...byId.get(id),
        display_order: index + 1,
      })),
    }),
  );
}

describe("NotesTable row reordering", () => {
  test("tabbing from a row skips the pointer-only drag handle", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByLabelText("Reorder AAAA");
    const row = rowFor(container, "AAAA");
    act(() => row.focus());
    await user.tab();

    // The handle sits first in the row, so Tab must step over it straight to
    // the selection checkbox; keyboard focus never lands on a control the
    // keys cannot operate.
    expect(screen.getByLabelText("Select AAAA")).toHaveFocus();
  });

  test("hovering the gap between rows keeps the drop placeholder steady", async () => {
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    // Hover the lower half of the target row: the placeholder should be
    // inserted into the gap right below it.
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    const placeholder = container.querySelector(
      ".table-drop-placeholder-row",
    );
    expect(placeholder).not.toBeNull();

    // The placeholder now sits under the pointer. Leaving the row for the
    // placeholder must NOT clear the target, otherwise the placeholder
    // unmounts and remounts in a loop (the flicker this fixes).
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragleave", {
          clientY: 400,
          dataTransfer,
          relatedTarget: placeholder,
        }),
      );
    });

    expect(
      container.querySelector(".table-drop-placeholder-row"),
    ).not.toBeNull();

    // Releasing over the placeholder still commits the reorder.
    await act(async () => {
      placeholder.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1], 1);
    });
  });

  test("a drag over the filter rail leaves the rows where they are", async () => {
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const shell = container.querySelector(".table-shell");
    const scroller = container.querySelector(".table-scroll-x");

    // The rail is 48px tall, so the scrollport starts that far below the
    // card's top edge. This is the geometry that used to make the rail a
    // scroll hot zone.
    HTMLElement.prototype.getBoundingClientRect.mockImplementation(
      function boundsFor() {
        if (this === shell) {
          return bounds(100, 700);
        }
        if (this === scroller) {
          return bounds(148, 700);
        }
        return bounds(0, 43);
      },
    );

    scroller.scrollTop = 100;
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    // The pointer is in the rail's band: inside the old top hot zone but
    // above the rows, so nothing should move.
    await act(async () => {
      shell.dispatchEvent(dragEvent("dragover", { clientY: 120, dataTransfer }));
    });
    expect(scroller.scrollTop).toBe(100);

    // A drag just inside the scrollport's own top edge still scrolls.
    await act(async () => {
      shell.dispatchEvent(dragEvent("dragover", { clientY: 160, dataTransfer }));
    });
    expect(scroller.scrollTop).toBeLessThan(100);

    // Cancel the drag so the preview clone does not outlive the test.
    await act(async () => {
      handle.dispatchEvent(dragEvent("dragend", { dataTransfer }));
    });
  });

  test("a failed reorder restores the old order and says why", async () => {
    reorderNotes.mockRejectedValue(new Error("Order could not be saved"));
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Order could not be saved")).toBeInTheDocument();
    });

    // The optimistic order is rolled back, so the collector never keeps a
    // position the server rejected.
    const rows = Array.from(
      container.querySelectorAll("tbody tr.table-row-link"),
    ).map((row) => row.textContent);

    expect(rows[0]).toContain("AAAA");
    expect(rows[1]).toContain("BBBB");
    expect(rows[2]).toContain("CCCC");
  });

  test("dropping a row moves the keyboard cursor to its new place", async () => {
    // The server echoes the reordered notes back; the rows stay mounted.
    reorderNotes.mockResolvedValue({
      notes: [note(2, "BBBB"), note(3, "CCCC"), note(1, "AAAA")],
    });
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    // Real drags start with a mouse press on the handle, which must not
    // select the row by itself — selection happens on drop below.
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1], 1);
    });

    const movedRow = rowFor(container, "AAAA");
    await waitFor(() => {
      expect(movedRow).toHaveFocus();
    });
    expect(movedRow).toHaveClass("table-row-link--active");
  });

  test("Alt+Down saves the new order and focus follows the moved row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    const firstRow = await focusRow(container, "AAAA");

    expect(firstRow).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown",
    );

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(rowDenominations(container)).toEqual(["BBBB", "AAAA", "CCCC"]);
    expect(rowFor(container, "AAAA")).toHaveFocus();
    expect(rowFor(container, "AAAA")).toHaveClass("table-row-link--active");

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 1, 3], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
    expect(rowFor(container, "AAAA")).toHaveFocus();
  });

  test("Alt+Up saves the new order and keeps the cursor on the moved row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("CCCC");
    await focusRow(container, "CCCC");

    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(rowDenominations(container)).toEqual(["AAAA", "CCCC", "BBBB"]);
    expect(rowFor(container, "CCCC")).toHaveFocus();

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 3, 2], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("a gapped selection refuses the keyboard move and announces why", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    // BBBB and DDDD have CCCC between them: no unambiguous whole-selection
    // move, so the shortcut refuses instead of moving only one of them.
    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select DDDD"));
    await focusRow(container, "BBBB");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "BBBB",
      "CCCC",
      "DDDD",
      "EEEE",
    ]);
    expect(reorderNotes).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector(".table-announcer")).toHaveTextContent(
        "Select a continuous range to reorder",
      );
    });
  });

  test("the run moves past a neighbour as one block", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select CCCC"));
    await focusRow(container, "CCCC");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "DDDD",
      "BBBB",
      "CCCC",
      "EEEE",
    ]);
    expect(rowFor(container, "CCCC")).toHaveFocus();
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 4, 2, 3, 5], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("a run at either edge is a no-op with no request", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await focusRow(container, "AAAA");
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    await focusRow(container, "CCCC");
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  test("a filtered view refuses the move and announces why", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await chooseFilterField(user, "Denomination");
    await user.type(
      screen.getByRole("searchbox", { name: "Filter Denomination" }),
      "AAAA{Enter}",
    );
    await focusRow(container, "AAAA");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA"]);
    await waitFor(() => {
      expect(container.querySelector(".table-announcer")).toHaveTextContent(
        "Clear filters to reorder",
      );
    });
  });

  test("a non-default sort refuses the move and announces the sort hint", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("button", { name: "Company" }));
    await focusRow(container, "AAAA");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
    await waitFor(() => {
      expect(container.querySelector(".table-announcer")).toHaveTextContent(
        "Sort by # ascending to reorder",
      );
    });
  });

  test("a failed keyboard save rolls the order back and says why", async () => {
    const user = userEvent.setup();
    let rejectSave;
    reorderNotes.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await focusRow(container, "AAAA");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    // The optimistic move lands at once...
    expect(rowDenominations(container)).toEqual(["BBBB", "AAAA", "CCCC"]);

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 1, 3], 1);
    });
    expect(rowDenominations(container)).toEqual(["BBBB", "AAAA", "CCCC"]);

    // ...and the rejection restores the order from before the move.
    await act(async () => {
      rejectSave(new Error("Order could not be saved"));
    });

    await waitFor(() => {
      expect(screen.getByText("Order could not be saved")).toBeInTheDocument();
    });

    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
    expect(rowFor(container, "AAAA")).toHaveFocus();
  });

  test("Shift+Up/Down still leaves the order alone", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("BBBB");
    await focusRow(container, "BBBB");

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");

    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
    expect(rowFor(container, "BBBB")).toHaveFocus();
  });

  test("the row menu hides the move items when the view cannot reorder", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("button", { name: "Company" }));
    await user.click(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    );

    const menu = await screen.findByRole("menu", {
      name: "Actions for AAAA",
    });
    expect(
      within(menu).queryByRole("menuitem", { name: "Move up" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitem", { name: "Move down" }),
    ).not.toBeInTheDocument();
  });

  test("the row menu disables the edge moves and moves only its row", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    );

    let menu = await screen.findByRole("menu", {
      name: "Actions for AAAA",
    });
    expect(
      within(menu).getByRole("menuitem", { name: "Move up" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Move down" }),
    ).toBeEnabled();

    await user.keyboard("{Escape}");

    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select CCCC"));
    await user.click(
      screen.getByRole("button", { name: "Actions for CCCC" }),
    );

    menu = await screen.findByRole("menu", {
      name: "Actions for CCCC",
    });
    // The menu is row-scoped even with a multi-selection: no count, and only
    // CCCC moves.
    const moveDown = within(menu).getByRole("menuitem", {
      name: "Move down",
    });

    await user.click(moveDown);

    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "BBBB",
      "DDDD",
      "CCCC",
      "EEEE",
    ]);
    expect(screen.getByLabelText("Select BBBB")).toBeChecked();
    expect(screen.getByLabelText("Select CCCC")).toBeChecked();

    // Moving CCCC alone leaves the selection gapped, so the bulk bar now
    // refuses both whole-selection moves.
    const bar = screen.getByRole("region", { name: "Selection actions" });
    expect(
      within(bar).getByRole("button", { name: "Move 2 selected notes up" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(bar).getByRole("button", { name: "Move 2 selected notes down" }),
    ).toHaveAttribute("aria-disabled", "true");

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 2, 4, 3, 5], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("the menu on a row outside the selection moves that row alone", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select CCCC"));
    await user.click(
      screen.getByRole("button", { name: "Actions for EEEE" }),
    );

    const menu = await screen.findByRole("menu", {
      name: "Actions for EEEE",
    });
    // EEEE is not in the selection, so the count-free label is the contract:
    // the menu acts on the row it was opened from, not the far-away run.
    await user.click(within(menu).getByRole("menuitem", { name: "Move up" }));

    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "BBBB",
      "CCCC",
      "EEEE",
      "DDDD",
    ]);
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 2, 3, 5, 4], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("the bulk bar moves a contiguous selection as one block", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select CCCC"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 2 selected notes down",
    });

    expect(moveDown).toBeEnabled();
    await user.click(moveDown);

    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "DDDD",
      "BBBB",
      "CCCC",
      "EEEE",
    ]);
    expect(screen.getByLabelText("Select BBBB")).toBeChecked();
    expect(screen.getByLabelText("Select CCCC")).toBeChecked();
    expect(moveDown).toHaveFocus();
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 4, 2, 3, 5], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("the bulk move stays mounted and focused while the save is in flight", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    const byId = new Map(notes.map((item) => [item.id, item]));
    let resolveSave;
    getNotes.mockResolvedValue({ notes });
    reorderNotes.mockImplementation(
      (ids) =>
        new Promise((resolve) => {
          resolveSave = () =>
            resolve({
              notes: ids.map((id, index) => ({
                ...byId.get(id),
                display_order: index + 1,
              })),
            });
        }),
    );
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select BBBB"));
    await user.click(screen.getByLabelText("Select CCCC"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 2 selected notes down",
    });

    await user.click(moveDown);

    // The arrow keeps its node and its focus; it reports the save instead of
    // vanishing or accepting a second press.
    await waitFor(() => {
      expect(moveDown).toHaveAttribute("aria-disabled", "true");
    });
    expect(moveDown).toHaveAttribute("title", "Saving manual order…");
    expect(moveDown).toHaveFocus();

    await act(async () => {
      resolveSave();
    });

    await waitFor(() => {
      expect(moveDown).not.toHaveAttribute("aria-disabled");
    });
    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "DDDD",
      "BBBB",
      "CCCC",
      "EEEE",
    ]);
  });

  test("the bulk bar refuses a gapped selection", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select AAAA"));
    await user.click(screen.getByLabelText("Select CCCC"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const moveUp = within(bar).getByRole("button", {
      name: "Move 2 selected notes up",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 2 selected notes down",
    });

    expect(moveUp).toHaveAttribute("aria-disabled", "true");
    expect(moveDown).toHaveAttribute("aria-disabled", "true");
    expect(moveUp).toHaveAccessibleDescription(
      "Select a continuous range to reorder",
    );
    expect(moveUp).toHaveAttribute(
      "title",
      "Select a continuous range to reorder",
    );
    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "BBBB",
      "CCCC",
      "DDDD",
      "EEEE",
    ]);
  });

  test("the bulk bar disables the move that is already at the edge", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select AAAA"));
    await user.click(screen.getByLabelText("Select BBBB"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const moveUp = within(bar).getByRole("button", {
      name: "Move 2 selected notes up",
    });

    expect(moveUp).toHaveAttribute("aria-disabled", "true");
    expect(moveUp).toHaveAttribute(
      "title",
      "The selection is already at the top",
    );
    expect(moveUp).toHaveAccessibleDescription(
      "The selection is already at the top",
    );
    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  test("the bulk bar disables the move at the bottom edge", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByLabelText("Select DDDD"));
    await user.click(screen.getByLabelText("Select EEEE"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 2 selected notes down",
    });

    expect(moveDown).toHaveAttribute("aria-disabled", "true");
    expect(moveDown).toHaveAccessibleDescription(
      "The selection is already at the bottom",
    );
    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual([
      "AAAA",
      "BBBB",
      "CCCC",
      "DDDD",
      "EEEE",
    ]);
  });

  test("the bulk bar hides its move buttons when the view cannot reorder", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("button", { name: "Company" }));
    await user.click(screen.getByLabelText("Select AAAA"));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    expect(
      within(bar).queryByRole("button", { name: /^Move 1 selected note/ }),
    ).not.toBeInTheDocument();
  });

  test("an open row menu keeps its keys instead of reordering the row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    );
    await screen.findByRole("menu", { name: "Actions for AAAA" });

    // Even with focus back on the trigger, the open panel owns the arrows.
    const trigger = screen.getByRole("button", { name: "Actions for AAAA" });
    await act(async () => {
      trigger.focus();
    });
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(reorderNotes).not.toHaveBeenCalled();
    expect(rowDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  test("a burst of key presses saves once after the last move", async () => {
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
      note(5, "EEEE"),
    ];
    getNotes.mockResolvedValue({ notes });
    echoReorderedNotes(notes);
    const { container } = renderTable();

    await screen.findByText("AAAA");
    const row = await focusRow(container, "AAAA");

    // Fire the repeats synchronously, before the debounce window closes: one
    // request must carry the whole burst.
    await act(async () => {
      fireEvent.keyDown(row, { altKey: true, key: "ArrowDown" });
      fireEvent.keyDown(row, { altKey: true, key: "ArrowDown" });
    });

    expect(rowDenominations(container)).toEqual([
      "BBBB",
      "CCCC",
      "AAAA",
      "DDDD",
      "EEEE",
    ]);
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1, 4, 5], 1);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(1);
  });

  test("a move queued behind an in-flight save still lands", async () => {
    const user = userEvent.setup();
    const notes = [
      note(1, "AAAA"),
      note(2, "BBBB"),
      note(3, "CCCC"),
      note(4, "DDDD"),
    ];
    const byId = new Map(notes.map((item) => [item.id, item]));
    const resolvers = [];
    getNotes.mockResolvedValue({ notes });
    reorderNotes.mockImplementation(
      (ids) =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve({
              notes: ids.map((id, index) => ({
                ...byId.get(id),
                display_order: index + 1,
              })),
            }),
          );
        }),
    );
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await focusRow(container, "AAAA");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 1, 3, 4], 1);
    });
    // The first save is still open; this repeat queues behind it instead of
    // being dropped by the save-in-flight gate.
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(rowDenominations(container)).toEqual([
      "BBBB",
      "CCCC",
      "AAAA",
      "DDDD",
    ]);
    expect(reorderNotes).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers.shift()();
    });

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1, 4], 1);
    });

    await act(async () => {
      resolvers.shift()();
    });

    await waitFor(() => {
      expect(screen.queryByText("Saving manual order...")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(rowDenominations(container)).toEqual([
        "BBBB",
        "CCCC",
        "AAAA",
        "DDDD",
      ]);
    });
    expect(reorderNotes).toHaveBeenCalledTimes(2);
  });
});
