// Alt-toggles the desktop menu bar: the Tauri shell starts it hidden on
// Windows/Linux (auto-hide menu bar), and a solitary Alt
// press shows or hides it again. Alt combinations (access keys, Alt+Tab) and
// macOS (whose menu is global) never toggle.

function isUnmodifiedAltPress(event) {
  return (
    event?.key === "Alt" &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.metaKey
  );
}

// Tracks whether Alt is held alone: any other keydown disarms, blur disarms,
// and only an Alt keyup while armed reports a toggle.
function createMenuBarToggle() {
  let armed = false;

  return {
    keyDown(event) {
      if (event?.repeat) {
        return;
      }
      armed = isUnmodifiedAltPress(event);
    },
    keyUp(event) {
      const shouldToggle = armed && event?.key === "Alt";
      armed = false;
      return shouldToggle;
    },
    blur() {
      armed = false;
    },
  };
}

function menuToggleSupportedOnPlatform(platformLabel) {
  const normalized = String(platformLabel ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("mac") || normalized.includes("darwin")) {
    return false;
  }
  return normalized.includes("win") || normalized.includes("linux");
}

function currentPlatformLabel() {
  if (typeof navigator === "undefined") {
    return "";
  }
  return navigator.userAgentData?.platform ?? navigator.platform ?? "";
}

function getMenuBarToggleBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.noteHarborDesktop;
  if (!bridge || typeof bridge.toggleMenuBar !== "function") {
    return null;
  }

  return bridge;
}

// Listens for solitary Alt presses on `target` (normally `window`) and
// invokes the desktop toggle. Returns a detach function; without a bridge or
// on an unsupported platform it attaches nothing.
function attachMenuBarToggle(target, { bridge, platformLabel } = {}) {
  const resolvedBridge = bridge !== undefined ? bridge : getMenuBarToggleBridge();
  if (!resolvedBridge) {
    return () => {};
  }
  if (!menuToggleSupportedOnPlatform(platformLabel ?? currentPlatformLabel())) {
    return () => {};
  }

  const toggle = createMenuBarToggle();
  const onKeyDown = (event) => toggle.keyDown(event);
  const onKeyUp = (event) => {
    if (toggle.keyUp(event)) {
      resolvedBridge.toggleMenuBar()?.catch(() => {});
    }
  };
  const onBlur = () => toggle.blur();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}

export {
  attachMenuBarToggle,
  createMenuBarToggle,
  currentPlatformLabel,
  getMenuBarToggleBridge,
  menuToggleSupportedOnPlatform,
};
