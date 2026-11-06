import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  defaultFilterCommitMode,
  filterCommitModeStorageKey,
  loadFilterCommitMode,
  otherCommitMode,
  saveFilterCommitMode,
} from "./filterCommitMode.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("filter commit mode storage", () => {
  test("defaults to Replace", () => {
    expect(defaultFilterCommitMode).toBe("replace");
    expect(loadFilterCommitMode()).toBe("replace");
  });

  test("round-trips the latched mode", () => {
    saveFilterCommitMode("add");

    expect(window.localStorage.getItem(filterCommitModeStorageKey)).toBe("add");
    expect(loadFilterCommitMode()).toBe("add");
  });

  test("an invalid stored value loads Replace", () => {
    window.localStorage.setItem(filterCommitModeStorageKey, "sideways");

    expect(loadFilterCommitMode()).toBe("replace");
  });

  test("an unreadable store falls back to Replace", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(loadFilterCommitMode()).toBe("replace");

    getItem.mockRestore();
  });

  test("a failed write keeps the in-memory mode usable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => saveFilterCommitMode("add")).not.toThrow();

    setItem.mockRestore();
  });

  test("flipping swaps the two modes", () => {
    expect(otherCommitMode("replace")).toBe("add");
    expect(otherCommitMode("add")).toBe("replace");
  });
});
