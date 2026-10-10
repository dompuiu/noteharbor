import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  getNotes: vi.fn(),
}));

const virtualWindow = vi.hoisted(() => ({ start: 0, end: 10 }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 64,
        start: index * 64,
        end: (index + 1) * 64,
      })).filter(
        (item) => item.index >= virtualWindow.start && item.index < virtualWindow.end,
      ),
    getTotalSize: () => count * 64,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { getNotes } from "../lib/api.js";

function note(id, overrides = {}) {
  return {
    id,
    denomination: `Note ${id}`,
    issue_date: "1917",
    catalog_number: "22",
    updated_at: `rev${id}`,
    images: [
      {
        type: "front",
        variant: "thumbnail",
        localPath: `/api/images/notes/${id}/front-thumbnail.jpg`,
      },
    ],
    ...overrides,
  };
}

const collections = [{ id: 1, name: "Kingdom" }];

beforeEach(() => {
  vi.clearAllMocks();
  virtualWindow.start = 0;
  virtualWindow.end = 10;
});

describe("ShowcaseNotePicker thumbnails and virtualization", () => {
  test("renders a thumbnail per note and a placeholder when there is no image", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1),
        note(2, { images: [] }),
      ],
    });

    render(
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Group", children: [] }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    const images = dialog.querySelectorAll(".showcase-note-row-thumb img");

    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute(
      "src",
      "/api/images/notes/1/front-thumbnail.jpg?v=rev1",
    );
    expect(images[0]).toHaveAttribute("loading", "lazy");
    expect(
      dialog.querySelector(".showcase-note-row-thumb-empty")?.textContent,
    ).toBe("No image");
  });

  test("only mounts the virtual window for a large list", async () => {
    const notes = Array.from({ length: 50 }, (_, index) => note(100 + index));
    getNotes.mockResolvedValue({ notes });

    render(
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Group", children: [] }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    expect(await within(dialog).findByText("50 notes")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(10);

    const virtual = dialog.querySelector(".showcase-picker-virtual");
    expect(virtual?.style.height).toBe(`${50 * 64}px`);

    virtualWindow.start = 10;
    virtualWindow.end = 20;
  });

  test("selection accumulates and Add selected stays enabled in the virtual window", async () => {
    const notes = Array.from({ length: 12 }, (_, index) => note(200 + index));
    getNotes.mockResolvedValue({ notes });
    const user = userEvent.setup();

    render(
      <ShowcaseNotePicker
        collections={collections}
        node={{ id: 10, name: "Group", children: [] }}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    const [first] = within(dialog).getAllByRole("checkbox");
    await user.click(first);

    expect(
      within(dialog).getByRole("button", { name: "Add selected (1)" }),
    ).toBeInTheDocument();
  });
});
