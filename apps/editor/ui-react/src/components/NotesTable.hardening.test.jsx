import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseFilterField } from "../test/filterBar.js";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getCollections: vi.fn(),
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

import { getCollections, getNotes } from "../lib/api.js";
import { CollectionsProvider, useCollections } from "../lib/collections.jsx";
import { subscribeConnectionFailure } from "../lib/connection.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, overrides = {}) {
  return {
    id,
    display_order: id,
    denomination: `NOTE-${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...overrides,
  };
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
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

// The shell's live connection state, surfaced the way App reads it.
function ConnectionProbe() {
  const { connectionLostReason } = useCollections();
  return connectionLostReason ? <p>{`shell:${connectionLostReason}`}</p> : null;
}

function renderTableInsideShell() {
  return render(
    <CollectionsProvider>
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <NotesTable
          collection={{ id: 1, is_default: 1, name: "Test" }}
          collectionId={1}
          collections={[{ id: 1, is_default: 1, name: "Test" }]}
          collectionsError=""
          loadingCollections={false}
        />
        <ConnectionProbe />
      </MemoryRouter>
    </CollectionsProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Test" }],
  });
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
});

describe("NotesTable hardening: a failed load", () => {
  test("names the failure and offers the one recovery instead of a bare error line", async () => {
    getNotes.mockRejectedValue(new Error("Failed to fetch"));

    renderTable();

    expect(
      await screen.findByRole("heading", {
        name: "Couldn't load this collection's notes.",
      }),
    ).toBeInTheDocument();
    // The raw message stays visible: it is the only diagnostic a local user
    // has when the server is the thing that is down.
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(
      screen.getByText("Your notes stay on this device and aren't affected."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("the failure is announced, but the retry control is not part of the alert", async () => {
    getNotes.mockRejectedValue(new Error("Failed to fetch"));

    renderTable();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this collection's notes.");
    expect(alert).not.toContainElement(
      screen.getByRole("button", { name: "Try again" }),
    );
  });

  test("Try again refetches the collection and puts the table back", async () => {
    const user = userEvent.setup();
    getNotes
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({ notes: [note(1, { denomination: "AAAA" })] });

    renderTable();

    await screen.findByRole("button", { name: "Try again" });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("AAAA")).toBeInTheDocument();
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("heading", {
        name: "Couldn't load this collection's notes.",
      }),
    ).not.toBeInTheDocument();
  });

  test("a retry that fails again keeps the panel and its recovery", async () => {
    const user = userEvent.setup();
    getNotes
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockRejectedValueOnce(new Error("Still offline"));

    renderTable();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Still offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  test.each(["server", "database"])(
    "a %s failure is left to the shell card instead of a second load panel",
    async (reason) => {
      const error = new Error("Request failed.");
      error.reason = reason;
      getNotes.mockRejectedValue(error);
      const reported = [];
      const unsubscribe = subscribeConnectionFailure((failure) => {
        reported.push(failure);
      });

      try {
        renderTable();

        await waitFor(() => {
          expect(screen.queryByText("Loading notes…")).not.toBeInTheDocument();
        });
      } finally {
        unsubscribe();
      }

      expect(reported).toEqual([reason]);
      expect(
        screen.queryByRole("heading", {
          name: "Couldn't load this collection's notes.",
        }),
      ).not.toBeInTheDocument();
    },
  );

  test("a generic failure keeps the table's own panel", async () => {
    const error = new Error("The query failed.");
    error.reason = "generic";
    getNotes.mockRejectedValue(error);

    renderTable();

    expect(
      await screen.findByRole("heading", {
        name: "Couldn't load this collection's notes.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("The query failed.")).toBeInTheDocument();
  });

  test("a notes load that loses the server reaches the shell's live state", async () => {
    const error = new Error("Request failed.");
    error.reason = "server";
    getNotes.mockRejectedValue(error);

    renderTableInsideShell();

    expect(await screen.findByText("shell:server")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Couldn't load this collection's notes.",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("NotesTable hardening: degenerate rows", () => {
  test("a note without a denomination still names itself in every control", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(7, {
          denomination: "",
          catalog_number: "Fr. 2300",
          images: [],
        }),
      ],
    });

    renderTable();

    expect(
      await screen.findByRole("checkbox", { name: "Select Fr. 2300" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for Fr. 2300" }),
    ).toBeInTheDocument();
  });

  test("a note with no name at all falls back to its id", async () => {
    getNotes.mockResolvedValue({
      notes: [note(12, { denomination: "", catalog_number: "" })],
    });

    renderTable();

    expect(
      await screen.findByRole("checkbox", { name: "Select note 12" }),
    ).toBeInTheDocument();
  });

  // An archive moved between machines can reference an image file that is no
  // longer on disk. A broken-image glyph with its alt text spilling out of the
  // 56px cell is noise; the dash every other empty cell shows is the truth.
  test("a thumbnail that fails to load falls back to the empty-cell dash", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, {
          denomination: "AAAA",
          images: [
            {
              type: "front",
              variant: "thumbnail",
              localPath: "/api/images/notes/1/front-thumbnail.webp",
            },
          ],
        }),
      ],
    });

    renderTable();

    const image = await screen.findByAltText("AAAA front");
    fireEvent.error(image);

    await waitFor(() => {
      expect(screen.queryByAltText("AAAA front")).not.toBeInTheDocument();
    });
  });

  // The cell clips to one line, so the whole value has to survive somewhere:
  // the title carries it to the pointer.
  test("a long value keeps its full text in the cell's title", async () => {
    const longDenomination =
      "1,000,000,000 Lei — provisional issue overprinted with a very long descriptive denomination";

    getNotes.mockResolvedValue({
      notes: [note(1, { denomination: longDenomination })],
    });

    renderTable();

    const cell = (await screen.findByText(longDenomination)).closest("td");
    expect(cell).toHaveAttribute("title", longDenomination);
  });
});

describe("NotesTable hardening: a long filter chip", () => {
  test("keeps the whole value in the chip's tooltip and still reads as a control", async () => {
    const user = userEvent.setup();
    const longValue = `denomination ${"x".repeat(300)}`;
    getNotes.mockResolvedValue({ notes: [note(1, { denomination: "AAAA" })] });

    renderTable();

    await screen.findByText("AAAA");
    await chooseFilterField(user, "Denomination");
    await user.type(
      screen.getByRole("searchbox", { name: "Filter Denomination" }),
      `${longValue}{Enter}`,
    );

    // The chip clips to the rail, so the tooltip is the only place the whole
    // value survives — and it must not lose the hint that the chip is a button.
    const chip = screen.getByRole("button", {
      name: `Edit Denomination filter ${longValue}`,
    });
    expect(chip).toHaveAttribute(
      "title",
      `Edit Denomination filter: ${longValue}`,
    );
  });
});

describe("NotesTable hardening: the result count", () => {
  test("announces the filtered count politely and counts one note in the singular", async () => {
    getNotes.mockResolvedValue({
      notes: [note(1, { denomination: "AAAA" })],
    });

    renderTable();

    const summary = await screen.findByText(
      "Showing 1 of 1 note · sorted by # ascending",
    );
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(summary).toHaveAttribute("aria-atomic", "true");
  });

  test("keeps the plural once the collection holds more than one note", async () => {
    getNotes.mockResolvedValue({
      notes: [note(1), note(2)],
    });

    renderTable();

    expect(
      await screen.findByText("Showing 2 of 2 notes · sorted by # ascending"),
    ).toBeInTheDocument();
  });
});
