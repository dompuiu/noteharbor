import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeTag, tagKey } from "../lib/tags.js";
import { TagsField } from "./TagsField.jsx";

// The bulk Tag editor hangs above the selection bar. It is deliberately not a
// modal: the collector can still see the rows the change will touch, and the
// bar underneath stays in place. The panel owns only the staged lists; the
// Table screen owns the write and its refetch. The shared AnchoredPopover is
// not used because it anchors below its trigger and closes on blur; this
// surface hangs above the bar, keeps the table live, and owns its own Tab trap.
const panelWidth = 440;
const panelGap = 6;
const viewportMargin = 12;
const maxPanelHeight = 560;

function tagUnion(notes) {
  const byKey = new Map();

  for (const note of notes) {
    const seen = new Set();

    for (const tag of note.tags ?? []) {
      const name = normalizeTag(tag.name);
      const key = name.toLowerCase();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      const row = byKey.get(key) ?? { key, name, count: 0 };
      row.count += 1;
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

// Anchors the panel's bottom edge just above the selection bar, centred over
// it and clamped to the viewport. Using `bottom` rather than a measured `top`
// keeps the panel attached when its content grows or shrinks.
function panelLayout(anchor) {
  const width = Math.min(panelWidth, window.innerWidth - viewportMargin * 2);
  const barBox = anchor?.getBoundingClientRect?.() ?? null;
  const centre = barBox
    ? barBox.left + barBox.width / 2
    : window.innerWidth / 2;
  const left = Math.min(
    Math.max(viewportMargin, centre - width / 2),
    Math.max(viewportMargin, window.innerWidth - width - viewportMargin),
  );
  const bottom = barBox
    ? Math.max(viewportMargin, window.innerHeight - barBox.top + panelGap)
    : 82;
  const available = barBox
    ? barBox.top - panelGap - viewportMargin
    : window.innerHeight - bottom - viewportMargin;

  return {
    width,
    left,
    bottom,
    maxHeight: Math.max(
      180,
      Math.min(maxPanelHeight, window.innerHeight * 0.7, available),
    ),
  };
}

export function BulkTagPanel({
  anchorRef,
  error = "",
  notes = [],
  onApply,
  onClearAll,
  onClose,
  saving = false,
  vocabulary = [],
  vocabularyError = "",
  vocabularyLoading = false,
}) {
  const panelRef = useRef(null);
  const tagsFieldRef = useRef(null);
  const titleId = useId();
  const [stagedAdd, setStagedAdd] = useState([]);
  const [stagedRemove, setStagedRemove] = useState([]);
  const [layout, setLayout] = useState(() => panelLayout(anchorRef?.current));

  const union = useMemo(() => tagUnion(notes), [notes]);
  const selectedCount = notes.length;
  const selectedNoun = `${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`;

  // The add combobox only suggests Tags that are not already on every selected
  // note: adding one of those would change nothing. It still merges the
  // selection's own Tags in when the vocabulary fetch failed, so the panel
  // remains usable offline-ish.
  const suggestions = useMemo(() => {
    const everyNoteKeys = new Set(
      union.filter((row) => row.count === selectedCount).map((row) => row.key),
    );
    const byKey = new Map();

    for (const name of [...vocabulary, ...union.map((row) => row.name)]) {
      const normalized = normalizeTag(name);
      const key = normalized.toLowerCase();

      if (!key || everyNoteKeys.has(key) || byKey.has(key)) {
        continue;
      }

      byKey.set(key, normalized);
    }

    return [...byKey.values()];
  }, [selectedCount, union, vocabulary]);

  const suggestionCounts = useMemo(
    () => Object.fromEntries(union.map((row) => [row.key, row.count])),
    [union],
  );

  useLayoutEffect(() => {
    const update = () => setLayout(panelLayout(anchorRef?.current));

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    tagsFieldRef.current?.focus();
  }, []);

  function handleAddChange(next) {
    setStagedAdd(next);

    const keys = new Set(next.map(tagKey));
    setStagedRemove((current) =>
      current.some((key) => keys.has(key))
        ? current.filter((key) => !keys.has(key))
        : current,
    );
  }

  function stageRemoval(key) {
    setStagedRemove((current) =>
      current.includes(key) ? current : [...current, key],
    );
    setStagedAdd((current) =>
      current.some((name) => tagKey(name) === key)
        ? current.filter((name) => tagKey(name) !== key)
        : current,
    );
  }

  function unstageRemoval(key) {
    setStagedRemove((current) => current.filter((entry) => entry !== key));
  }

  const stagedCount = stagedAdd.length + stagedRemove.length;
  const canApply = !saving && stagedCount > 0;

  function handleApply() {
    if (!canApply) {
      return;
    }

    onApply({
      add: stagedAdd,
      remove: union
        .filter((row) => stagedRemove.includes(row.key))
        .map((row) => row.name),
    });
  }

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
      className="bulk-tag-panel"
      id="bulk-tag-panel"
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
      <div className="bulk-tag-panel-header">
        <div>
          <h2 className="bulk-tag-panel-title" id={titleId}>
            Tags
          </h2>
          <p className="bulk-tag-panel-scope">
            {selectedNoun} · staged changes apply together
          </p>
        </div>
        <button
          aria-label="Close"
          className="bulk-tag-panel-close"
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

      <div className="bulk-tag-panel-body">
        <section className="bulk-tag-section">
          <span className="bulk-tag-label">Add a tag</span>
          <TagsField
            ariaLabel="Add a tag"
            maxSuggestions={9}
            onChange={handleAddChange}
            placeholder="Type a tag and press Enter"
            ref={tagsFieldRef}
            showClearAll={false}
            suggestionCounts={suggestionCounts}
            suggestionTotal={selectedCount}
            value={stagedAdd}
            vocabulary={suggestions}
          />
          {vocabularyLoading ? (
            <p className="bulk-tag-hint">Loading suggestions…</p>
          ) : null}
          {!vocabularyLoading && vocabularyError ? (
            <p className="bulk-tag-hint">
              Suggestions unavailable · the selection's own tags are still
              listed.
            </p>
          ) : null}
        </section>

        <section className="bulk-tag-section">
          <div className="bulk-tag-section-heading">
            <span className="bulk-tag-label">On these notes</span>
            <span className="bulk-tag-hint">count = how many carry it</span>
          </div>
          {union.length ? (
            <ul className="bulk-tag-rows">
              {union.map((row) => {
                const staged = stagedRemove.includes(row.key);

                return (
                  <li
                    className={`bulk-tag-row${staged ? " is-staged" : ""}`}
                    key={row.key}
                  >
                    <span className="bulk-tag-name">{row.name}</span>
                    <span
                      aria-label={`${row.count} of ${selectedCount} notes`}
                      className={`bulk-tag-count${row.count === selectedCount ? " is-all" : ""}`}
                    >
                      {row.count}/{selectedCount}
                    </span>
                    {staged ? (
                      <button
                        aria-label={`Undo removal of ${row.name}`}
                        className="bulk-tag-undo"
                        onClick={() => unstageRemoval(row.key)}
                        type="button"
                      >
                        undo
                      </button>
                    ) : (
                      <button
                        aria-label={`Remove ${row.name} from the selected notes`}
                        className="bulk-tag-remove"
                        onClick={() => stageRemoval(row.key)}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          focusable="false"
                          height="12"
                          viewBox="0 0 24 24"
                          width="12"
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
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="bulk-tag-empty">The selection carries no tags yet.</p>
          )}
        </section>
      </div>

      <span aria-live="polite" className="bulk-tag-announcer">
        {stagedCount
          ? `${stagedAdd.length} tag${stagedAdd.length === 1 ? "" : "s"} to add, ${stagedRemove.length} to remove.`
          : ""}
      </span>

      {error ? (
        <p className="error-text bulk-tag-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="bulk-tag-panel-footer">
        <button
          className="bulk-tag-clear"
          disabled={saving || union.length === 0}
          onClick={() => onClearAll(union.map((row) => row.name))}
          type="button"
        >
          Clear all tags…
        </button>
        <span className="bulk-tag-footer-spacer" />
        <button
          className="button bulk-tag-cancel"
          disabled={saving}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={!canApply}
          onClick={handleApply}
          type="button"
        >
          {saving
            ? "Applying…"
            : `Apply to ${selectedCount} note${selectedCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>,
    document.body,
  );
}
