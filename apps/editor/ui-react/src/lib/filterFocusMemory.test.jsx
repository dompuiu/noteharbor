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
