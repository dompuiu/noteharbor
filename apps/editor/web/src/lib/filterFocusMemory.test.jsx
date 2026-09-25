import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  shouldHandOffToFilters,
  useFilterFocusMemory,
} from "./filterFocusMemory.js";

describe("shouldHandOffToFilters", () => {
  const rowElement = {};
  const base = {
    activeElement: rowElement,
    currentIndex: 0,
    offset: -1,
    rowElement,
  };

  test("hands off going up from the focused first row", () => {
    expect(shouldHandOffToFilters(base)).toBe(true);
  });

  test("stays in the rows when moving down", () => {
    expect(shouldHandOffToFilters({ ...base, offset: 1 })).toBe(false);
  });

  test("stays in the rows from any row below the first", () => {
    expect(shouldHandOffToFilters({ ...base, currentIndex: 2 })).toBe(false);
  });

  test("stays in the rows when no row is focused", () => {
    expect(
      shouldHandOffToFilters({
        ...base,
        currentIndex: -1,
        rowElement: null,
      }),
    ).toBe(false);
  });

  test("stays in the rows when focus moved off the first row", () => {
    expect(shouldHandOffToFilters({ ...base, activeElement: {} })).toBe(false);
  });
});

function FilterHarness() {
  const [showCatalog, setShowCatalog] = useState(true);
  const orderedKeys = [
    "denomination",
    ...(showCatalog ? ["catalog_number"] : []),
    "grading_company",
  ];
  const { focusFilter, focusRememberedFilter, getFilterRef, rememberFilter } =
    useFilterFocusMemory(orderedKeys);

  const bind = (key) => ({
    onFocus: () => rememberFilter(key),
    ref: getFilterRef(key),
  });

  return (
    <div>
      <button onClick={() => focusRememberedFilter()} type="button">
        Remembered
      </button>
      <button onClick={() => focusFilter("grading_company")} type="button">
        Focus company
      </button>
      <button onClick={() => setShowCatalog(false)} type="button">
        Hide catalog
      </button>
      <input
        aria-label="Filter Denomination"
        defaultValue=""
        {...bind("denomination")}
      />
      {showCatalog ? (
        <input
          aria-label="Filter Catalog #"
          defaultValue="22"
          {...bind("catalog_number")}
        />
      ) : null}
      <input
        aria-label="Filter Company"
        defaultValue=""
        {...bind("grading_company")}
      />
    </div>
  );
}

describe("useFilterFocusMemory", () => {
  test("falls back to the first visible field when nothing is remembered", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(screen.getByLabelText("Filter Denomination")).toHaveFocus();
  });

  test("returns to the last focused field and selects its contents", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    const catalog = screen.getByLabelText("Filter Catalog #");
    await user.click(catalog);
    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(catalog).toHaveFocus();
    expect(catalog.selectionStart).toBe(0);
    expect(catalog.selectionEnd).toBe(2);
  });

  test("falls back when the remembered column is no longer rendered", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    await user.click(screen.getByLabelText("Filter Catalog #"));
    await user.click(screen.getByRole("button", { name: "Hide catalog" }));
    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(screen.getByLabelText("Filter Denomination")).toHaveFocus();
  });

  test("a hidden remembered column is forgotten in favour of the fallback", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    await user.click(screen.getByLabelText("Filter Catalog #"));
    await user.click(screen.getByRole("button", { name: "Hide catalog" }));
    await user.click(screen.getByRole("button", { name: "Remembered" }));
    // Move into a later field, then ask for the remembered one again.
    await user.click(screen.getByLabelText("Filter Company"));
    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(screen.getByLabelText("Filter Company")).toHaveFocus();
  });

  test("focusFilter moves focus without selecting contents", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    const company = screen.getByLabelText("Filter Company");
    const selectSpy = vi.spyOn(company, "select");
    await user.click(screen.getByRole("button", { name: "Focus company" }));

    expect(company).toHaveFocus();
    expect(selectSpy).not.toHaveBeenCalled();
  });
});

// Mirrors TagsField: an imperative handle created without deps, which React
// re-assigns on every render. The fallback must follow the declared column
// order, not the order refs happen to be (re)assigned.
const ImperativeField = forwardRef(function ImperativeField(
  { label, onFocus },
  forwardedRef,
) {
  const inputRef = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    select: () => inputRef.current?.select(),
  }));

  return (
    <input
      aria-label={label}
      defaultValue=""
      onFocus={onFocus}
      ref={inputRef}
    />
  );
});

function ImperativeHarness() {
  const [tick, setTick] = useState(0);
  const { focusRememberedFilter, getFilterRef, rememberFilter } =
    useFilterFocusMemory(["tags", "denomination"]);

  const bind = (key) => ({
    onFocus: () => rememberFilter(key),
    ref: getFilterRef(key),
  });

  return (
    <div>
      <button onClick={() => setTick((current) => current + 1)} type="button">
        Rerender
      </button>
      <button onClick={() => focusRememberedFilter()} type="button">
        Remembered
      </button>
      <span>{tick}</span>
      <ImperativeField label="Filter Tags" {...bind("tags")} />
      <input
        aria-label="Filter Denomination"
        defaultValue=""
        {...bind("denomination")}
      />
    </div>
  );
}

describe("useFilterFocusMemory fallback order", () => {
  test("uses the declared column order, not the ref-assignment order", async () => {
    const user = userEvent.setup();
    render(<ImperativeHarness />);

    // Force the imperative handle to be re-assigned before jumping.
    await user.click(screen.getByRole("button", { name: "Rerender" }));
    await user.click(screen.getByRole("button", { name: "Remembered" }));

    expect(screen.getByLabelText("Filter Tags")).toHaveFocus();
  });
});
