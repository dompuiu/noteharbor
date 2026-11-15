import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The shared shell for the panels the selection bar opens (Tags, Ownership).
// They hang above the bar instead of covering the table as a modal: the rows
// the change will touch stay visible and the bar underneath stays in place.
// The shell owns placement, the close button, Escape and the Tab trap; each
// panel owns only its staged value and the Table screen owns the write.
const panelGap = 6;
const viewportMargin = 12;
const maxPanelHeight = 560;

// Anchors the panel's bottom edge just above the selection bar, centred over
// it and clamped to the viewport. Using `bottom` rather than a measured `top`
// keeps the panel attached when its content grows or shrinks.
function panelLayout(anchor, width) {
  const clampedWidth = Math.min(width, window.innerWidth - viewportMargin * 2);
  const barBox = anchor?.getBoundingClientRect?.() ?? null;
  const centre = barBox
    ? barBox.left + barBox.width / 2
    : window.innerWidth / 2;
  const left = Math.min(
    Math.max(viewportMargin, centre - clampedWidth / 2),
    Math.max(viewportMargin, window.innerWidth - clampedWidth - viewportMargin),
  );
  const bottom = barBox
    ? Math.max(viewportMargin, window.innerHeight - barBox.top + panelGap)
    : 82;
  const available = barBox
    ? barBox.top - panelGap - viewportMargin
    : window.innerHeight - bottom - viewportMargin;

  return {
    width: clampedWidth,
    left,
    bottom,
    maxHeight: Math.max(
      180,
      Math.min(maxPanelHeight, window.innerHeight * 0.7, available),
    ),
  };
}

export function BulkPanel({
  anchorRef,
  announcer = "",
  children,
  error = "",
  focusRef,
  id,
  onClose,
  onPrimary,
  primaryDisabled = false,
  primaryLabel,
  saving = false,
  scope = "",
  secondary = null,
  title,
  width = 440,
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const [layout, setLayout] = useState(() =>
    panelLayout(anchorRef?.current, width),
  );

  useLayoutEffect(() => {
    const update = () => setLayout(panelLayout(anchorRef?.current, width));

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, width]);

  useEffect(() => {
    focusRef?.current?.focus();
  }, [focusRef]);

  // A failed write leaves the panel open for a retry, but the disabled Apply
  // button that had focus is now gone (or re-enabled unfocused). Move focus to
  // the panel itself so Escape and the Tab trap work again.
  useEffect(() => {
    if (error) {
      panelRef.current?.focus();
    }
  }, [error]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      if (saving) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const items = Array.from(
      panelRef.current?.querySelectorAll(
        "button:not([disabled]), input:not([disabled])",
      ) ?? [],
    );

    if (!items.length) {
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="false"
      className="bulk-panel"
      id={id}
      onKeyDown={handleKeyDown}
      ref={panelRef}
      role="dialog"
      style={{
        bottom: layout.bottom,
        left: layout.left,
        maxHeight: layout.maxHeight,
        width: layout.width,
      }}
      tabIndex={-1}
    >
      <div className="bulk-panel-header">
        <div>
          <h2 className="bulk-panel-title" id={titleId}>
            {title}
          </h2>
          <p className="bulk-panel-scope">{scope}</p>
        </div>
        <button
          aria-label="Close"
          className="bulk-panel-close"
          disabled={saving}
          onClick={onClose}
          type="button"
        >
          <svg
            aria-hidden="true"
            focusable="false"
            height="14"
            viewBox="0 0 24 24"
            width="14"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>

      <div className="bulk-panel-body">{children}</div>

      <span aria-live="polite" className="bulk-panel-announcer">
        {announcer}
      </span>

      {error ? (
        <p className="error-text bulk-panel-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="bulk-panel-footer">
        {secondary}
        <span className="bulk-panel-spacer" />
        <button
          className="button"
          disabled={saving}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={primaryDisabled || saving}
          onClick={onPrimary}
          type="button"
        >
          {saving ? "Applying…" : primaryLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
