import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { TablePerfBoundary } from "./TablePerfBoundary.jsx";

// Counts how many times the lazy overlay module is actually imported. The
// boundary must not pull in the Profiler when the flag is off.
const overlayModule = vi.hoisted(() => ({ loads: 0 }));

vi.mock("./TablePerfOverlay.jsx", () => {
  overlayModule.loads += 1;

  return {
    default: function FakeTablePerfOverlay({ children }) {
      return (
        <div data-testid="table-perf-overlay">{children}</div>
      );
    },
  };
});

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TablePerfBoundary>
        <div data-testid="table-body">the table</div>
      </TablePerfBoundary>
    </MemoryRouter>,
  );
}

test("renders the table untouched and imports no profiler without the flag", () => {
  renderAt("/catalog/collections/1/view");

  expect(screen.getByTestId("table-body")).toBeInTheDocument();
  expect(screen.queryByTestId("table-perf-overlay")).toBeNull();
  // The overlay module, and with it React's Profiler wrapper, was never
  // imported at all.
  expect(overlayModule.loads).toBe(0);
});

test("wraps the table in the readout when the URL carries ?perf", async () => {
  renderAt("/catalog/collections/1/view?perf");

  expect(await screen.findByTestId("table-perf-overlay")).toBeInTheDocument();
  expect(screen.getByTestId("table-body")).toBeInTheDocument();
  expect(overlayModule.loads).toBe(1);
});

test("a query value other than the perf flag does not switch it on", () => {
  renderAt("/catalog/collections/1/view?performance=1");

  expect(screen.queryByTestId("table-perf-overlay")).toBeNull();
});
