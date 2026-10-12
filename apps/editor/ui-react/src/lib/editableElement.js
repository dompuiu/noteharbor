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

export { isEditableElement };
