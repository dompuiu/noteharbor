import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";

function node() {
  return {
    id: 20,
    node_type: "grouping",
    name: "Sub",
    children: [],
    cover_note: null,
    cover_note_id: null,
  };
}

function props(overrides = {}) {
  return {
    node: node(),
    onRemove: vi.fn(),
    onRename: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

async function startEditing() {
  await userEvent.click(screen.getByRole("button", { name: "Rename Sub" }));
  return screen.getByRole("textbox", { name: "New name for Sub" });
}

describe("ShowcaseGroupingEditor grouping-name icon", () => {
  test("the rename form hides the folder icon at the small photo size", async () => {
    render(<ShowcaseGroupingEditor {...props({ photoSize: "small" })} />);

    await startEditing();

    expect(
      document.querySelector(
        ".showcase-grouping-rename-form .showcase-card-name-icon",
      ),
    ).toBeNull();
  });

  test("the rename form keeps the folder icon at larger photo sizes", async () => {
    render(<ShowcaseGroupingEditor {...props({ photoSize: "medium" })} />);

    await startEditing();

    expect(
      document.querySelector(
        ".showcase-grouping-rename-form .showcase-card-name-icon",
      ),
    ).not.toBeNull();
  });

  test("the idle title keeps the folder icon at the small photo size", () => {
    render(<ShowcaseGroupingEditor {...props({ photoSize: "small" })} />);

    expect(
      document.querySelector(
        ".showcase-grouping-name .showcase-card-name-icon",
      ),
    ).not.toBeNull();
  });
});
