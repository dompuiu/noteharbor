import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";

// `import.meta.env.DEV` is folded to `false` by the production build, which
// lets the bundler drop this branch and the lazily imported chunk with it.
// The readout therefore cannot ship in a production bundle even by accident.
const TablePerfOverlay = import.meta.env.DEV
  ? lazy(() => import("./TablePerfOverlay.jsx"))
  : null;

export function perfReadoutRequested(search) {
  return new URLSearchParams(search).has("perf");
}

// The Table screen is wrapped only when the developer asks for the readout
// with `?perf`; otherwise this component hands the table straight through, so
// there is no Profiler subtree and the overlay module is never imported.
export function TablePerfBoundary({ children }) {
  const { search } = useLocation();

  if (!TablePerfOverlay || !perfReadoutRequested(search)) {
    return children;
  }

  return (
    <Suspense fallback={children}>
      <TablePerfOverlay>{children}</TablePerfOverlay>
    </Suspense>
  );
}
