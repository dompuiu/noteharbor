import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  onReorder,
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
      onReorder={
        onReorder
          ? async (ids) => {
              await onReorder(ids);
              setRecords((current) =>
                ids
                  .map((id) => current.find((record) => record.id === id))
                  .filter(Boolean),
              );
            }
          : undefined
      }
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

  test("Home and End jump to the first and last row", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Beta").focus();

    await user.keyboard("{End}");
    expect(rowFor("Gamma")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("PageDown and PageUp move a page and clamp", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Alpha").focus();

    await user.keyboard("{PageDown}");
    expect(rowFor("Gamma")).toHaveFocus();

    await user.keyboard("{PageUp}");
    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("Shift+Arrow does not pull the row focus", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Alpha").focus();

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");

    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("Escape on a focused row drops the cursor to the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    rowFor("Alpha").focus();
    await user.keyboard("{Escape}");

    const anchor = container.querySelector(".table-focus-anchor");
    expect(anchor).toHaveFocus();
    expect(rowFor("Alpha")).not.toHaveClass("named-record-row--focused");
  });

  test("ArrowDown from an unfocused screen starts on the first row", async () => {
    const user = userEvent.setup();
    renderTable();

    document.body.focus();
    await user.keyboard("{ArrowDown}");

    expect(rowFor("Alpha")).toHaveFocus();
  });

  test("a mouse press focuses a row without painting the cursor", async () => {
    const user = userEvent.setup();
    renderTable();

    const beta = rowFor("Beta");
    act(() => {
      fireEvent.mouseDown(beta);
      beta.focus();
      fireEvent.mouseUp(beta);
    });

    expect(beta).toHaveFocus();
    expect(beta).not.toHaveClass("named-record-row--focused");

    await user.keyboard("{ArrowDown}");
    expect(rowFor("Gamma")).toHaveFocus();
    expect(rowFor("Gamma")).toHaveClass("named-record-row--focused");
  });
});

describe("NamedRecordsTable shortcuts", () => {
  test("`a` opens the add row and focuses its input", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.keyboard("a");

    expect(
      screen.getByRole("textbox", { name: "New collection name" }),
    ).toHaveFocus();
  });

  test("`e` begins editing the focused row", async () => {
    const user = userEvent.setup();
    renderTable();

    rowFor("Beta").focus();
    await user.keyboard("e");

    expect(
      screen.getByRole("textbox", { name: "Rename Beta" }),
    ).toHaveFocus();
  });

  test("`d` deletes the focused row after confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    rowFor("Beta").focus();
    await user.keyboard("d");

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: 'Delete "Beta"?' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(2);
  });

  test("`a`/`e`/`d` do nothing while typing in a field", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Rename Beta" }));
    const input = screen.getByRole("textbox", { name: "Rename Beta" });
    await user.type(input, "aead");

    expect(input).toHaveValue("Betaaead");
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("NamedRecordsTable reordering", () => {
  test("no drag handles appear when the caller does not accept reorders", () => {
    renderTable();

    expect(screen.queryByLabelText("Move Alpha")).not.toBeInTheDocument();
  });

  test("dropping a row hands the caller the new id order", async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<Harness onReorder={onReorder} />);

    const handle = screen.getByLabelText("Move Alpha");
    const targetRow = rowFor("Gamma");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    expect(
      container.querySelector(".table-drop-placeholder-row"),
    ).not.toBeNull();

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(onReorder).toHaveBeenCalledWith([2, 3, 1]);
    });

    await waitFor(() => {
      const names = Array.from(
        container.querySelectorAll("tbody tr.named-record-row .named-records-name-cell"),
        (cell) => cell.textContent,
      );
      expect(names).toEqual(["Beta", "Gamma", "Alpha"]);
    });
  });

  test("dropping a row back where it started does not persist a no-op order", async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined);
    render(<Harness onReorder={onReorder} />);

    const handle = screen.getByLabelText("Move Beta");
    const targetRow = rowFor("Gamma");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      // A negative clientY is above the row's (all-zero) rect midpoint, so
      // the computed placement is "before" — which leaves the order unchanged.
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: -5, dataTransfer }),
      );
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: -5, dataTransfer }),
      );
    });

    expect(onReorder).not.toHaveBeenCalled();
  });

  test("hovering the placeholder keeps the drop target steady", async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<Harness onReorder={onReorder} />);

    const handle = screen.getByLabelText("Move Alpha");
    const targetRow = rowFor("Gamma");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    const placeholder = container.querySelector(".table-drop-placeholder-row");
    expect(placeholder).not.toBeNull();

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
  });
});
