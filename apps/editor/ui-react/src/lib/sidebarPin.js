// The sidebar rail expands on hover or keyboard focus and collapses again
// when both leave. The pin holds it at the expanded width with neither, so it
// becomes part of the layout instead of an overlay. One app-wide preference,
// so it lives under its own key, like the filter commit mode.
export const sidebarPinStorageKey = "noteharbor.sidebarPinned";

// A missing, invalid or unreadable value resolves to unpinned, which keeps
// today's hover and focus behaviour.
export function loadSidebarPinned() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(sidebarPinStorageKey) === "true";
  } catch {
    return false;
  }
}

// A storage failure leaves the in-memory state in charge; it never blocks the
// toggle.
export function saveSidebarPinned(pinned) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      sidebarPinStorageKey,
      pinned ? "true" : "false",
    );
  } catch {
    // The pin is already set in memory; there is nothing else to do.
  }
}
