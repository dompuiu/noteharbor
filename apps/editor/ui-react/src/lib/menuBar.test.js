import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  attachMenuBarToggle,
  createMenuBarToggle,
  getMenuBarToggleBridge,
  menuToggleSupportedOnPlatform,
} from "./menuBar.js";

beforeEach(() => {
  delete window.noteHarborDesktop;
  vi.restoreAllMocks();
});

function keyEvent(key, overrides = {}) {
  return { key, repeat: false, ctrlKey: false, shiftKey: false, metaKey: false, ...overrides };
}

function stubTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    emit(type, event) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
  };
}

describe("createMenuBarToggle", () => {
  test("a solitary Alt press arms and toggles on release", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt"));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(true);
  });

  test("Alt plus another key never toggles", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt"));
    toggle.keyDown(keyEvent("x"));
    toggle.keyUp(keyEvent("x"));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(false);
  });

  test("key repeat does not arm the toggle", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt", { repeat: true }));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(false);
  });

  test("Alt with a modifier held does not arm the toggle", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt", { ctrlKey: true }));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(false);
  });

  test("losing focus disarms a held Alt", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt"));
    toggle.blur();
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(false);
  });

  test("a second solitary press toggles again", () => {
    const toggle = createMenuBarToggle();
    toggle.keyDown(keyEvent("Alt"));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(true);
    toggle.keyDown(keyEvent("Alt"));
    expect(toggle.keyUp(keyEvent("Alt"))).toBe(true);
  });
});

describe("menuToggleSupportedOnPlatform", () => {
  test("Windows and Linux labels are supported", () => {
    expect(menuToggleSupportedOnPlatform("Windows")).toBe(true);
    expect(menuToggleSupportedOnPlatform("Win32")).toBe(true);
    expect(menuToggleSupportedOnPlatform("Linux x86_64")).toBe(true);
    expect(menuToggleSupportedOnPlatform("Linux")).toBe(true);
  });

  test("macOS and unknown labels are not supported", () => {
    expect(menuToggleSupportedOnPlatform("MacIntel")).toBe(false);
    expect(menuToggleSupportedOnPlatform("macOS")).toBe(false);
    expect(menuToggleSupportedOnPlatform("darwin")).toBe(false);
    expect(menuToggleSupportedOnPlatform("")).toBe(false);
    expect(menuToggleSupportedOnPlatform(undefined)).toBe(false);
  });
});

describe("getMenuBarToggleBridge", () => {
  test("returns null without a desktop bridge", () => {
    delete window.noteHarborDesktop;
    expect(getMenuBarToggleBridge()).toBeNull();
  });

  test("returns null when the bridge has no toggle", () => {
    window.noteHarborDesktop = {};
    expect(getMenuBarToggleBridge()).toBeNull();
  });

  test("returns the bridge when it can toggle", () => {
    const bridge = { toggleMenuBar: vi.fn() };
    window.noteHarborDesktop = bridge;
    expect(getMenuBarToggleBridge()).toBe(bridge);
  });
});

describe("attachMenuBarToggle", () => {
  test("does nothing without a bridge", () => {
    const target = stubTarget();
    const detach = attachMenuBarToggle(target, { bridge: null, platformLabel: "Windows" });
    expect(target.listeners.get("keydown")?.length ?? 0).toBe(0);
    detach();
  });

  test("does nothing on macOS", () => {
    const target = stubTarget();
    const bridge = { toggleMenuBar: vi.fn() };
    const detach = attachMenuBarToggle(target, { bridge, platformLabel: "MacIntel" });
    target.emit("keydown", keyEvent("Alt"));
    target.emit("keyup", keyEvent("Alt"));
    expect(bridge.toggleMenuBar).not.toHaveBeenCalled();
    detach();
  });

  test("a solitary Alt press invokes the toggle and detach removes listeners", () => {
    const target = stubTarget();
    const bridge = { toggleMenuBar: vi.fn().mockResolvedValue(true) };
    const detach = attachMenuBarToggle(target, { bridge, platformLabel: "Windows" });

    target.emit("keydown", keyEvent("Alt"));
    target.emit("keyup", keyEvent("Alt"));
    expect(bridge.toggleMenuBar).toHaveBeenCalledTimes(1);

    target.emit("keydown", keyEvent("Alt"));
    target.emit("keydown", keyEvent("x"));
    target.emit("keyup", keyEvent("Alt"));
    expect(bridge.toggleMenuBar).toHaveBeenCalledTimes(1);

    detach();
    expect(target.listeners.get("keydown")?.length ?? 0).toBe(0);
    expect(target.listeners.get("keyup")?.length ?? 0).toBe(0);
    expect(target.listeners.get("blur")?.length ?? 0).toBe(0);
  });
});
