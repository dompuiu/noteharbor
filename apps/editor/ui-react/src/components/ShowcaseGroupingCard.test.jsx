import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";

const FRONT = {
  type: "front",
  variant: "thumbnail",
  localPath: "/api/images/notes/100/front-thumbnail.jpg",
};

function note(id = 100) {
  return {
    id,
    denomination: "1",
    issue_date: "1915",
    updated_at: `rev-${id}`,
    images: [FRONT],
  };
}

function noteNode(id = 11, theNote = note()) {
  return {
    id,
    node_type: "note",
    name: null,
    note_id: theNote.id,
    note: theNote,
    cover_note: null,
    children: [],
  };
}

function groupingNode(children = [], overrides = {}) {
  return {
    id: 20,
    node_type: "grouping",
    name: "1 leu - Tip 1 (1915-1938)",
    note: null,
    cover_note: null,
    cover_note_id: null,
    children,
    ...overrides,
  };
}

function renderCard(node, options = {}) {
  const grip = <span data-testid="grouping-grip" />;
  const menu = (
    <button data-testid="grouping-menu" type="button">
      Actions
    </button>
  );

  return render(
    <ShowcaseGroupingCard
      grip={grip}
      layout={options.layout}
      menu={menu}
      node={node}
      onOpen={options.onOpen}
    />,
  );
}

describe("ShowcaseGroupingCard folio", () => {
  test("one header carries the grip, name and actions menu", () => {
    const { container } = renderCard(groupingNode([noteNode()]));

    const card = screen.getByRole("button", {
      name: "Open grouping 1 leu - Tip 1 (1915-1938)",
    });
    const header = container.querySelector(".showcase-grouping-head");
    const grip = screen.getByTestId("grouping-grip");
    const menu = screen.getByTestId("grouping-menu");

    expect(header).not.toBeNull();
    expect(header).toHaveTextContent("1 leu - Tip 1 (1915-1938)");
    // The folder leads the title, on the same x as a catalog code.
    expect(header.querySelector("svg")).not.toBeNull();
    expect(header.querySelector("svg")).toHaveClass(
      "showcase-grouping-head-icon",
    );
    expect(container.querySelector(".showcase-grouping")).toContainElement(grip);
    expect(card).not.toContainElement(grip);
    expect(card).not.toContainElement(menu);
    expect(container.querySelector(".showcase-reorder-bar")).toBeNull();
    expect(
      container.querySelector(".showcase-grouping-action"),
    ).toHaveTextContent("Open");
    // The card is tabbed before the actions menu, matching catalog cards.
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]).toBe(card);
    expect(buttons[1]).toBe(menu);
  });

  test("the footer summarizes direct children and no count sits in the header", () => {
    const node = groupingNode([
      noteNode(11),
      noteNode(12),
      {
        id: 30,
        node_type: "grouping",
        name: "Deep",
        note: null,
        cover_note: null,
        children: [],
      },
      {
        id: 40,
        node_type: "catalog_entry",
        name: null,
        note: null,
        cover_note: null,
        children: [],
        entry: { catalog_number: "22", denomination: "1 leu" },
      },
    ]);
    const { container } = renderCard(node);

    const summary = container.querySelector(".showcase-grouping-summary");
    expect(summary).toHaveTextContent("2 notes · 1 placeholder · 1 grouping");
    expect(container.querySelector(".showcase-grouping-head")).not.toHaveTextContent(
      /items?/,
    );
    expect(
      screen.getByRole("button", {
        name: "Open grouping 1 leu - Tip 1 (1915-1938)",
      }),
    ).toHaveAccessibleDescription("2 notes · 1 placeholder · 1 grouping");
  });

  test("an empty grouping says so in the footer and shows a neutral cover", () => {
    const { container } = renderCard(groupingNode([]));

    expect(screen.getByText("No items yet")).toBeInTheDocument();
    expect(screen.getByText("No cover")).toBeInTheDocument();
    expect(container.querySelector(".showcase-grouping-empty")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("the resolved cover is the image and the button opens the grouping", async () => {
    const onOpen = vi.fn();
    const cover = note(100);
    const { container } = renderCard(
      groupingNode([noteNode(11, cover)], { cover_note: cover }),
      { onOpen },
    );
    const card = screen.getByRole("button", {
      name: "Open grouping 1 leu - Tip 1 (1915-1938)",
    });

    expect(within(card).getByText("1 leu - Tip 1 (1915-1938)")).toBeVisible();
    expect(card.querySelector("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front-thumbnail.jpg?v=rev-100",
    );

    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".showcase-card--grouping")).toBe(card);
  });
});

describe("ShowcaseGroupingCard rail label", () => {
  test("the Auction rail turns the grouping into a cover/identity split", () => {
    const { container } = renderCard(
      groupingNode([noteNode(11), noteNode(12), noteNode(13)]),
      { layout: "rail" },
    );

    const card = screen.getByRole("button", {
      name: "Open grouping 1 leu - Tip 1 (1915-1938)",
    });
    const rail = container.querySelector(".showcase-grouping-rail-body");

    expect(card).toHaveClass("showcase-card--grouping-rail");
    expect(rail).not.toBeNull();
    expect(rail).toHaveTextContent("Grouping");
    expect(rail).toHaveTextContent("3 notes");
    expect(rail.querySelector(".showcase-grouping-rail-count")).toHaveTextContent(
      "3",
    );
    expect(rail).toHaveTextContent("items");
    expect(container.querySelector(".showcase-grouping-head")).toBeNull();
    expect(container.querySelector(".showcase-grouping-meta")).toBeNull();
    expect(container.querySelector(".showcase-grouping-action")).toHaveTextContent(
      "Open",
    );
    expect(card).toHaveAccessibleDescription("3 notes");
  });

  test("the rail label still carries the grip and menu outside the button", () => {
    const { container } = renderCard(
      groupingNode([noteNode(11)]),
      { layout: "rail" },
    );
    const card = screen.getByRole("button", {
      name: "Open grouping 1 leu - Tip 1 (1915-1938)",
    });

    expect(card).not.toContainElement(screen.getByTestId("grouping-grip"));
    expect(card).not.toContainElement(screen.getByTestId("grouping-menu"));
    expect(container.querySelector(".showcase-reorder-bar")).toBeNull();
  });

  test("the rail count counts records, not nested containers", () => {
    const { container } = renderCard(
      groupingNode([
        noteNode(11),
        noteNode(12),
        {
          id: 30,
          node_type: "grouping",
          name: "Deep",
          note: null,
          cover_note: null,
          children: [],
        },
      ]),
      { layout: "rail" },
    );

    const count = container.querySelector(".showcase-grouping-rail-count");
    expect(count).toHaveTextContent("2");
    expect(container.querySelector(".showcase-grouping-summary")).toHaveTextContent(
      "2 notes · 1 grouping",
    );
  });

  test("an empty rail label skips the zero count", () => {
    const { container } = renderCard(groupingNode([]), { layout: "rail" });

    expect(container.querySelector(".showcase-grouping-summary")).toHaveTextContent(
      "No items yet",
    );
    expect(
      container.querySelector(".showcase-grouping-rail-stats"),
    ).toBeNull();
  });
});
