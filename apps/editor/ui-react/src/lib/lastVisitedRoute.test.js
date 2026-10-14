import { beforeEach, describe, expect, test } from "vitest";
import {
  LAST_VISITED_ROUTE_STORAGE_KEY,
  normalizeLastVisitedRoute,
  readStoredLastVisitedRoute,
  routeFromLocation,
  writeStoredLastVisitedRoute,
} from "./lastVisitedRoute.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("normalizeLastVisitedRoute", () => {
  test("collapses to the first-level screen and drops query and hash", () => {
    expect(normalizeLastVisitedRoute("/catalog/collections")).toBe(
      "/catalog/collections",
    );
    expect(normalizeLastVisitedRoute("/catalog/import-export")).toBe(
      "/catalog/import-export",
    );
    expect(normalizeLastVisitedRoute("/catalog/banknotes")).toBe(
      "/catalog/collections",
    );
    // A collection restores on its table, never the slideshow or editor hash.
    expect(normalizeLastVisitedRoute("/catalog/collections/1/view")).toBe(
      "/catalog/collections/1/view",
    );
    expect(normalizeLastVisitedRoute("/catalog/collections/1/edit")).toBe(
      "/catalog/collections/1/view",
    );
    expect(normalizeLastVisitedRoute("/catalog/collections/1")).toBe(
      "/catalog/collections/1/view",
    );
    expect(
      normalizeLastVisitedRoute("/catalog/collections/1/view#slideshow/2"),
    ).toBe("/catalog/collections/1/view");
    expect(normalizeLastVisitedRoute("/catalog/collections/1/view#edit/7")).toBe(
      "/catalog/collections/1/view",
    );
    // A showcase restores on its root view, never a `?node=` drill or edit.
    expect(normalizeLastVisitedRoute("/portfolio/showcases/2/view")).toBe(
      "/portfolio/showcases/2/view",
    );
    expect(normalizeLastVisitedRoute("/portfolio/showcases/2/edit")).toBe(
      "/portfolio/showcases/2/view",
    );
    expect(normalizeLastVisitedRoute("/portfolio/showcases/2")).toBe(
      "/portfolio/showcases/2/view",
    );
    expect(
      normalizeLastVisitedRoute("/portfolio/showcases/2/view?node=3"),
    ).toBe("/portfolio/showcases/2/view");
  });

  test("rejects the root, unknown, note-editor, and draft addresses", () => {
    expect(normalizeLastVisitedRoute(null)).toBeNull();
    expect(normalizeLastVisitedRoute("")).toBeNull();
    expect(normalizeLastVisitedRoute("/")).toBeNull();
    expect(normalizeLastVisitedRoute("/settings/advanced")).toBeNull();
    expect(normalizeLastVisitedRoute("/api/health")).toBeNull();
    // The standalone note editor names no collection to restore.
    expect(normalizeLastVisitedRoute("/catalog/notes/7/edit")).toBeNull();
    expect(
      normalizeLastVisitedRoute("/catalog/collections/abc/view"),
    ).toBeNull();
    expect(
      normalizeLastVisitedRoute("/catalog/collections/1/view/extra"),
    ).toBeNull();
    expect(normalizeLastVisitedRoute("/portfolio/showcases")).toBeNull();
    expect(
      normalizeLastVisitedRoute("/portfolio/showcases/2/view/extra"),
    ).toBeNull();
    expect(normalizeLastVisitedRoute("/catalog/collections/new/edit")).toBeNull();
    expect(normalizeLastVisitedRoute("/portfolio/showcases/new/edit")).toBeNull();
  });

  test("rejects absolute urls and suspicious values", () => {
    expect(normalizeLastVisitedRoute("https://example.com/")).toBeNull();
    expect(normalizeLastVisitedRoute("//catalog/x")).toBeNull();
    expect(normalizeLastVisitedRoute("/catalog/x with space")).toBeNull();
    expect(normalizeLastVisitedRoute("/catalog/\\x")).toBeNull();
    expect(normalizeLastVisitedRoute(`"/catalog/x"`)).toBeNull();
    expect(normalizeLastVisitedRoute("a".repeat(3000))).toBeNull();
  });
});

describe("stored last visited route", () => {
  test("round-trips through localStorage", () => {
    expect(readStoredLastVisitedRoute()).toBeNull();
    writeStoredLastVisitedRoute("/catalog/collections/1/view");
    expect(readStoredLastVisitedRoute()).toBe("/catalog/collections/1/view");
    expect(
      window.localStorage.getItem(LAST_VISITED_ROUTE_STORAGE_KEY),
    ).toBe("/catalog/collections/1/view");
  });

  test("an invalid write clears the stored route", () => {
    writeStoredLastVisitedRoute("/catalog/collections/1/view");
    writeStoredLastVisitedRoute("/");
    expect(readStoredLastVisitedRoute()).toBeNull();
  });

  test("routeFromLocation collapses to the first level", () => {
    expect(
      routeFromLocation({
        pathname: "/portfolio/showcases/2/view",
        search: "?node=3",
        hash: "",
      }),
    ).toBe("/portfolio/showcases/2/view");
    expect(
      routeFromLocation({
        pathname: "/catalog/collections/1/view",
        search: "",
        hash: "#slideshow/2",
      }),
    ).toBe("/catalog/collections/1/view");
    expect(
      routeFromLocation({
        pathname: "/catalog/collections/1/edit",
        search: "",
        hash: "",
      }),
    ).toBe("/catalog/collections/1/view");
    expect(routeFromLocation({ pathname: "/", search: "", hash: "" })).toBeNull();
    expect(routeFromLocation(null)).toBeNull();
  });
});
