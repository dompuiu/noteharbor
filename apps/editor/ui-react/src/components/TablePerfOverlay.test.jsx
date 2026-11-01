import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import TablePerfOverlay, { PERF_ROWS_KEY } from "./TablePerfOverlay.jsx";

// Stands in for a note row: it announces the id exactly the way NoteRow does
// and re-renders only when its own state changes.
function Probe() {
  const [rowId, setRowId] = useState(1);
  globalThis[PERF_ROWS_KEY]?.add(rowId);

  return (
    <button type="button" onClick={() => setRowId(rowId + 1)}>
      row {rowId}
    </button>
  );
}

function durationValue(container) {
  return container.querySelector(".table-perf-overlay-duration")?.textContent;
}

function rowsValue(container) {
  return container.querySelector(".table-perf-overlay-rows")?.textContent;
}

afterEach(() => {
  delete globalThis[PERF_ROWS_KEY];
});

test("reports the last commit duration and the rows that commit rendered", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <TablePerfOverlay>
      <Probe />
    </TablePerfOverlay>,
  );

  expect(
    screen.getByRole("status", { name: "Table performance" }),
  ).toBeInTheDocument();

  await waitFor(() => {
    expect(durationValue(container)).toMatch(/^\d+\.\d ms$/);
  });
  expect(rowsValue(container)).toBe("1 rows");

  await user.click(screen.getByRole("button", { name: "row 1" }));

  // The new commit rendered one row again, not the accumulated total.
  expect(rowsValue(container)).toBe("1 rows");
  expect(durationValue(container)).toMatch(/^\d+\.\d ms$/);
});

test("removes its row counter global when it unmounts", () => {
  const { unmount } = render(
    <TablePerfOverlay>
      <Probe />
    </TablePerfOverlay>,
  );

  expect(globalThis[PERF_ROWS_KEY]).toBeInstanceOf(Set);
  unmount();
  expect(globalThis[PERF_ROWS_KEY]).toBeUndefined();
});
