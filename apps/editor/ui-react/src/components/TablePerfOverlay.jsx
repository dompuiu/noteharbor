import { Profiler, useEffect, useRef } from "react";

// The note rows add their id here while they render (see NoteRow.jsx), and the
// profiler callback drains the set after each commit. A dev-only global means
// the row does not import the overlay (or React's Profiler) unless the readout
// is switched on.
export const PERF_ROWS_KEY = "__noteHarborPerfRows";

const panelStyle = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 1000,
  display: "flex",
  gap: 10,
  padding: "6px 10px",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: 6,
  background: "rgba(15, 23, 42, 0.88)",
  color: "#e2e8f0",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  lineHeight: 1.4,
  pointerEvents: "none",
};

const labelStyle = { color: "#94a3b8" };
const valueStyle = { fontVariantNumeric: "tabular-nums" };

function rowSet() {
  if (!globalThis[PERF_ROWS_KEY]) {
    globalThis[PERF_ROWS_KEY] = new Set();
  }

  return globalThis[PERF_ROWS_KEY];
}

// Wrap the Table screen when the URL carries the `perf` flag. React's commit
// time is the number that matters for this work, and the row count tells you
// how much of the table the commit actually touched.
export default function TablePerfOverlay({ children }) {
  const rows = rowSet();
  const durationRef = useRef(null);
  const rowsRef = useRef(null);
  // The profiler callback can run before the panel's refs are attached on the
  // first commit, so keep the latest numbers here and paint them after mount.
  const latestRef = useRef({ duration: "-", rows: "- rows" });

  function paint() {
    if (durationRef.current) {
      durationRef.current.textContent = latestRef.current.duration;
    }

    if (rowsRef.current) {
      rowsRef.current.textContent = latestRef.current.rows;
    }
  }

  useEffect(() => {
    paint();

    return () => {
      if (globalThis[PERF_ROWS_KEY] === rows) {
        delete globalThis[PERF_ROWS_KEY];
      }
    };
    // The panel is painted once on mount; later commits paint from the
    // profiler callback itself, before re-rendering anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRender(id, phase, actualDuration, baseDuration, startTime) {
    const renderedRows = rows.size;
    rows.clear();

    latestRef.current = {
      duration: `${actualDuration.toFixed(1)} ms`,
      rows: `${renderedRows} rows`,
    };
    paint();

    // Playwright can collect every commit instead of sampling the panel.
    try {
      performance.measure("noteharbor:table-commit", {
        start: startTime,
        end: startTime + actualDuration,
        detail: {
          id,
          phase,
          actualDuration,
          baseDuration,
          rows: renderedRows,
        },
      });
    } catch {
      // User Timing options are missing in older engines; the panel still
      // reports the same numbers.
    }
  }

  return (
    <>
      <Profiler id="notes-table" onRender={handleRender}>
        {children}
      </Profiler>
      <aside
        aria-label="Table performance"
        className="table-perf-overlay"
        role="status"
        style={panelStyle}
      >
        <span style={labelStyle}>commit</span>
        <span className="table-perf-overlay-duration" ref={durationRef} style={valueStyle}>
          -
        </span>
        <span style={labelStyle}>rendered</span>
        <span className="table-perf-overlay-rows" ref={rowsRef} style={valueStyle}>
          - rows
        </span>
      </aside>
    </>
  );
}
