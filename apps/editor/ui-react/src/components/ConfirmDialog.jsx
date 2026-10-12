import { useCallback, useEffect, useId, useRef, useState } from "react";

// The app's own confirmation dialog, used for every destructive action and
// for the Note editor's unsaved-changes prompt. It takes a title, an optional
// body, and a confirm/cancel label pair, and reports which was chosen. The
// cancel choice is focused on open, so a stray Enter (or Tab to it) is the
// safe one; Escape always abandons.
function ConfirmDialog({
  body,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  onCancel,
  onConfirm,
  title,
}) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const first = cancelRef.current;
      const last = confirmRef.current;

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const titleId = useId();
  const bodyId = `${titleId}-body`;

  return (
    <div className="confirm-dialog-overlay" role="presentation">
      <div
        aria-describedby={body ? bodyId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <h2 className="confirm-dialog-title" id={titleId}>
          {title}
        </h2>
        {body ? (
          <p className="confirm-dialog-body" id={bodyId}>
            {body}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button
            className="button"
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="button button-danger"
            onClick={onConfirm}
            ref={confirmRef}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Pairs the dialog with the promise-shaped call sites: `confirm(options)`
// resolves true when the user confirms and false when they cancel or
// dismiss. Render `dialog` somewhere in the tree.
function useConfirmation() {
  const [request, setRequest] = useState(null);
  const requestRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        // A second request must never strand the first promise: settle it as
        // a cancel before replacing it.
        const previousRequest = requestRef.current;
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        requestRef.current = { options, resolve };
        setRequest(requestRef.current);
        previousRequest?.resolve(false);
      }),
    [],
  );

  const settle = useCallback((result) => {
    const current = requestRef.current;
    const previousFocus = restoreFocusRef.current;
    requestRef.current = null;
    restoreFocusRef.current = null;
    setRequest(null);

    if (previousFocus?.isConnected) {
      previousFocus.focus();
    }

    current?.resolve(result);
  }, []);

  const dialog = request ? (
    <ConfirmDialog
      {...request.options}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, dialog, isOpen: Boolean(request) };
}

export { ConfirmDialog, useConfirmation };
