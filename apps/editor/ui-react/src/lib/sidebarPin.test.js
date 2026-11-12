import { beforeEach, describe, expect, test } from "vitest";
import {
  loadSidebarPinned,
  saveSidebarPinned,
  sidebarPinStorageKey,
} from "./sidebarPin.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("sidebar pin preference", () => {
  test("defaults to unpinned when nothing is stored", () => {
    expect(loadSidebarPinned()).toBe(false);
  });

  test("round-trips through localStorage", () => {
    saveSidebarPinned(true);
    expect(window.localStorage.getItem(sidebarPinStorageKey)).toBe("true");
    expect(loadSidebarPinned()).toBe(true);

    saveSidebarPinned(false);
    expect(loadSidebarPinned()).toBe(false);
  });

  // A bare `true` from another writer, a stale value, or a cleared store must
  // never leave the rail pinned by accident.
  test("anything but the stored true value reads as unpinned", () => {
    for (const value of ["1", "yes", "TRUE", "", "false"]) {
      window.localStorage.setItem(sidebarPinStorageKey, value);
      expect(loadSidebarPinned()).toBe(false);
    }
  });
});
