import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// The last visited page, remembered like the Tauri window position so the
// next launch opens where the previous session left off. Web builds keep it
// in localStorage; the desktop shell additionally persists it file-backed
// through `window.noteHarborDesktop` (every desktop launch is a fresh
// localStorage origin behind the embedded server's random port, mirroring
// the showcase photo size in `photoSize.js`).
const LAST_VISITED_ROUTE_STORAGE_KEY = "noteharbor.lastVisitedRoute";

const MAX_LAST_VISITED_ROUTE_LENGTH = 2000;

// Keep in sync with `normalize_last_visited_route` in
// `desktop-tauri/src-tauri/src/prefs.rs`.
function normalizeLastVisitedRoute(value) {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw || raw.length > MAX_LAST_VISITED_ROUTE_LENGTH) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f \\\"<>\`]/.test(raw)) {
    return null;
  }
  const pathEnd = raw.search(/[?#]/);
  const pathname = pathEnd === -1 ? raw : raw.slice(0, pathEnd);
  const known =
    pathname === "/catalog/collections" ||
    pathname.startsWith("/catalog/") ||
    pathname.startsWith("/portfolio/");
  if (!known) {
    return null;
  }
  if (pathname.split("/").includes("new")) {
    return null;
  }
  return raw;
}

function readStoredLastVisitedRoute() {
  if (typeof window === "undefined") {
    return null;
  }
  return normalizeLastVisitedRoute(
    window.localStorage.getItem(LAST_VISITED_ROUTE_STORAGE_KEY),
  );
}

function writeStoredLastVisitedRoute(route) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeLastVisitedRoute(route);
  if (normalized === null) {
    window.localStorage.removeItem(LAST_VISITED_ROUTE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LAST_VISITED_ROUTE_STORAGE_KEY, normalized);
}

function getDesktopLastVisitedRouteBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = window.noteHarborDesktop;
  if (
    !bridge ||
    typeof bridge.getLastVisitedRoute !== "function" ||
    typeof bridge.setLastVisitedRoute !== "function"
  ) {
    return null;
  }
  return bridge;
}

function routeFromLocation(location) {
  if (!location) {
    return null;
  }
  const pathname = location.pathname ?? "";
  const search = location.search ?? "";
  const hash = location.hash ?? "";
  return normalizeLastVisitedRoute(`${pathname}${search}${hash}`);
}

// Persists every visited page and, when the app boots on `/`, restores the
// remembered one. On desktop the Tauri shell already loads the saved route
// as the WebView's initial URL (see `initial_app_url`), so the restore is a
// no-op there; it covers web builds and a missing initial URL.
function LastVisitedRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const restoredRef = useRef(false);

  useEffect(() => {
    const route = routeFromLocation(location);
    if (route === null) {
      return;
    }
    writeStoredLastVisitedRoute(route);
    getDesktopLastVisitedRouteBridge()?.setLastVisitedRoute(route)?.catch(() => {});
  }, [location.pathname, location.search, location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    if (location.pathname !== "/") {
      return;
    }
    const bridge = getDesktopLastVisitedRouteBridge();
    if (bridge) {
      bridge
        .getLastVisitedRoute()
        .then((stored) => {
          const route = normalizeLastVisitedRoute(stored);
          if (route) {
            navigate(route, { replace: true });
          }
        })
        .catch(() => {});
      return;
    }
    const stored = readStoredLastVisitedRoute();
    if (stored) {
      navigate(stored, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export {
  LAST_VISITED_ROUTE_STORAGE_KEY,
  LastVisitedRouteSync,
  MAX_LAST_VISITED_ROUTE_LENGTH,
  getDesktopLastVisitedRouteBridge,
  normalizeLastVisitedRoute,
  readStoredLastVisitedRoute,
  routeFromLocation,
  writeStoredLastVisitedRoute,
};
