// Whether an element is a text-bearing form control: the fields whose own
// keyboard handling (caret movement, closing a dropdown) should win over the
// screen's shortcuts.
function isEditableElement(element) {
  return (
    element instanceof HTMLElement &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable)
  );
}

// Input types that hold no text of their own. A printable shortcut may pass
// through them (the space bar still activates them natively).
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

// Full-screen or modal surfaces that own their keys until dismissed. The Note
// editor and the Note slideshow are overlays rather than role="dialog", so
// list their classes alongside the roles.
const MODAL_SURFACE_SELECTOR =
  "[role='dialog'], [role='alertdialog'], .edit-note-overlay, .slideshow-screen--overlay";

// The table's filter rail holds view controls rather than row content, so the
// table's Escape and arrow keys keep working while focus is on it.
const TABLE_RAIL_SELECTOR = ".table-rail";

// Whether the focused element should keep a printable shortcut such as "b"
// for itself: text entry needs the letter for typing, and a modal surface
// owns every key until it closes.
function ownsPrintableShortcut(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.closest(MODAL_SURFACE_SELECTOR)) {
    return true;
  }

  if (element.tagName === "TEXTAREA" || element.tagName === "SELECT") {
    return true;
  }

  if (element.tagName === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has(element.type);
  }

  return element.isContentEditable;
}

export {
  isEditableElement,
  MODAL_SURFACE_SELECTOR,
  ownsPrintableShortcut,
  TABLE_RAIL_SELECTOR,
};
