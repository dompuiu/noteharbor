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
  test("accepts catalog and portfolio pages with query and hash", () => {
    expect(normalizeLastVisitedRoute("/catalog/collections")).toBe(
      "/catalog/collections",
    );
    expect(normalizeLastVisitedRoute("/catalog/collections/1/view")).toBe(
      "/catalog/collections/1/view",
    );
    expect(
      normalizeLastVisitedRoute("/portfolio/showcases/2/view?node=3"),
    ).toBe("/portfolio/showcases/2/view?node=3");
    expect(normalizeLastVisitedRoute("/catalog/import-export")).toBe(
      "/catalog/import-export",
    );
  });

  test("rejects the root, unknown, and draft addresses", () => {
    expect(normalizeLastVisitedRoute(null)).toBeNull();
    expect(normalizeLastVisitedRoute("")).toBeNull();
    expect(normalizeLastVisitedRoute("/")).toBeNull();
    expect(normalizeLastVisitedRoute("/settings/advanced")).toBeNull();
    expect(normalizeLastVisitedRoute("/api/health")).toBeNull();
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

  test("routeFromLocation keeps search and hash", () => {
    expect(
      routeFromLocation({
        pathname: "/portfolio/showcases/2/view",
        search: "?node=3",
        hash: "",
      }),
    ).toBe("/portfolio/showcases/2/view?node=3");
    expect(routeFromLocation({ pathname: "/", search: "", hash: "" })).toBeNull();
    expect(routeFromLocation(null)).toBeNull();
  });
});
