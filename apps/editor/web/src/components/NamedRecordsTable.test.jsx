import { useRef, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NamedRecordsTable } from "./NamedRecordsTable.jsx";

const baseRecords = [
  { id: 1, isDefault: true, name: "Alpha" },
  { id: 2, isDefault: false, name: "Beta" },
  { id: 3, isDefault: false, name: "Gamma" },
];

// A controlled parent: the table is stateless, so CRUD tests need a host that
// applies each callback to the record list and feeds it back in.
function Harness({
  initialRecords = baseRecords,
  onCreate = vi.fn(),
  onDelete = vi.fn(),
  onSetDefault = vi.fn(),
  onUpdate = vi.fn(),
}) {
  const [records, setRecords] = useState(initialRecords);
  const nextId = useRef(100);

  return (
    <NamedRecordsTable
      ariaLabel="Collections"
      emptyText="No collections yet."
      itemLabel="collection"
      itemLabelPlural="collections"
      records={records}
      onCreate={async (name) => {
        const created = { id: (nextId.current += 1), isDefault: false, name };
        await onCreate(name);
        setRecords((current) => [...current, created]);
        return created;
      }}
      onDelete={async (id) => {
        await onDelete(id);
        setRecords((current) => current.filter((record) => record.id !== id));
      }}
      onSetDefault={async (id) => {
        await onSetDefault(id);
        setRecords((current) =>
          current.map((record) => ({
            ...record,
            isDefault: record.id === id,
          })),
        );
      }}
      onUpdate={async (id, name) => {
        await onUpdate(id, name);
        setRecords((current) =>
          current.map((record) =>
            record.id === id ? { ...record, name } : record,
          ),
        );
      }}
    />
  );
}

function rowFor(name) {
  return screen.getByText(name).closest("tr");
}

function renderTable() {
  return render(<Harness />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NamedRecordsTable rendering", () => {
  test("renders one row per record with its name", () => {
    renderTable();

    expect(rowFor("Alpha")).toBeInTheDocument();
    expect(rowFor("Beta")).toBeInTheDocument();
    expect(rowFor("Gamma")).toBeInTheDocument();
  });

  test("exactly one row carries the filled default star", () => {
    renderTable();

    const stars = screen.getAllByRole("button", { name: /default/i });
    const filled = stars.filter(
      (star) => star.textContent === "★" || star.getAttribute("aria-pressed") === "true",
    );

    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveAccessibleName("Alpha is the default");
  });

  test("an empty record list shows the empty text", () => {
    render(<Harness initialRecords={[]} />);

    expect(screen.getByText("No collections yet.")).toBeInTheDocument();
  });
});

describe("NamedRecordsTable default flag", () => {
  test("clicking a row's star makes that row the default", async () => {
    const user = userEvent.setup();
    const onSetDefault = vi.fn();
    render(<Harness onSetDefault={onSetDefault} />);

    await user.click(screen.getByRole("button", { name: "Mark Beta as default" }));

    expect(onSetDefault).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Beta is the default" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Mark Alpha as default" }),
    ).toBeInTheDocument();
  });
});

describe("NamedRecordsTable create", () => {
  test("adds a named row through the add action", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: "Add collection" }));

    const input = screen.getByRole("textbox", { name: "New collection name" });
    expect(input).toHaveFocus();

    await user.type(input, "Delta{Enter}");

    expect(onCreate).toHaveBeenCalledWith("Delta");
    const newRow = await screen.findByText("Delta");
    await waitFor(() => {
      expect(newRow.closest("tr")).toHaveFocus();
    });
    expect(newRow.closest("tr")).toHaveClass("named-record-row--focused");
  });

  test("Escape cancels the in-progress add", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: "Add collection" }));
    await user.type(
      screen.getByRole("textbox", { name: "New collection name" }),
      "Delta{Escape}",
    );

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "New collection name" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add collection" })).toHaveFocus();
  });
});

describe("NamedRecordsTable rename", () => {
  test("Enter on the focused row begins editing and saves a new name", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<Harness onUpdate={onUpdate} />);

    const row = rowFor("Beta");
    row.focus();
    await user.keyboard("{Enter}");

    const input = screen.getByRole("textbox", { name: "Rename Beta" });
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, "Beta Prime{Enter}");

    expect(onUpdate).toHaveBeenCalledWith(2, "Beta Prime");
    const renamed = await screen.findByText("Beta Prime");
    await waitFor(() => {
      expect(renamed.closest("tr")).toHaveFocus();
    });
  });

  test("Escape abandons an edit without saving", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<Harness onUpdate={onUpdate} />);

    await user.click(screen.getByRole("button", { name: "Rename Beta" }));
    const input = screen.getByRole("textbox", { name: "Rename Beta" });
    await user.clear(input);
    await user.type(input, "Discarded{Escape}");

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Rename Beta" }),
    ).not.toBeInTheDocument();
  });
});

describe("NamedRecordsTable delete", () => {
  test("deletes a record after confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete Beta" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: 'Delete "Beta"?' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });
  });

  test("cancelling the confirmation keeps the record", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete Beta" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  test("focus lands on the row that replaces the deleted one", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Delete Beta" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const replacement = await screen.findByText("Gamma");
    await waitFor(() => {
      expect(replacement.closest("tr")).toHaveFocus();
    });
    expect(replacement.closest("tr")).toHaveClass("named-record-row--focused");
  });

  test("deleting the last row keeps the cursor on the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initialRecords={[baseRecords[0]]} />);

    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const anchor = container.querySelector(".table-focus-anchor");
    await waitFor(() => {
      expect(anchor).toHaveFocus();
    });
  });
});

describe("NamedRecordsTable selection", () => {
  test("a row checkbox toggles that row only", async () => {
    const user = userEvent.setup();
    renderTable();

    const beta = screen.getByRole("checkbox", { name: "Select Beta" });
    await user.click(beta);

    expect(beta).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Alpha" }),
    ).not.toBeChecked();
    expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
  });

  test("select all toggles every row and back", async () => {
    const user = userEvent.setup();
    renderTable();

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all collections",
    });
    await user.click(selectAll);

    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Gamma" })).toBeChecked();
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();

    await user.click(selectAll);

    expect(
      screen.getByRole("checkbox", { name: "Select Alpha" }),
    ).not.toBeChecked();
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
  });

  test("a partial selection marks the select-all box indeterminate", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("checkbox", { name: "Select Beta" }));

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all collections",
    });
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll).not.toBeChecked();
  });
});

describe("NamedRecordsTable keyboard navigation", () => {
  test("ArrowDown / ArrowUp move the row cursor", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Alpha").focus();

    await user.keyboard("{ArrowDown}");
    expect(rowFor("Beta")).toHaveFocus();
    expect(rowFor("Beta")).toHaveClass("named-record-row--focused");

    await user.keyboard("{ArrowUp}");
    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("j / k alias the arrow keys", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Alpha").focus();

    await user.keyboard("j");
    expect(rowFor("Beta")).toHaveFocus();

    await user.keyboard("k");
    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("the cursor clamps at the ends of the list", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Alpha").focus();
    await user.keyboard("{ArrowUp}");
    expect(rowFor("Alpha")).toHaveFocus();

    rowFor("Gamma").focus();
    await user.keyboard("{ArrowDown}");
    expect(rowFor("Gamma")).toHaveFocus();
  });
});
