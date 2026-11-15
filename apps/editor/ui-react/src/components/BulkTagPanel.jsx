import { useMemo, useRef, useState } from "react";
import { normalizeTag, tagKey } from "../lib/tags.js";
import { BulkPanel } from "./BulkPanel.jsx";
import { TagsField } from "./TagsField.jsx";

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
  const tagsFieldRef = useRef(null);
  const [stagedAdd, setStagedAdd] = useState([]);
  const [stagedRemove, setStagedRemove] = useState([]);

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

  return (
    <BulkPanel
      anchorRef={anchorRef}
      announcer={
        stagedCount
          ? `${stagedAdd.length} tag${stagedAdd.length === 1 ? "" : "s"} to add, ${stagedRemove.length} to remove.`
          : ""
      }
      error={error}
      focusRef={tagsFieldRef}
      id="bulk-tag-panel"
      onClose={onClose}
      onPrimary={handleApply}
      primaryDisabled={!canApply}
      primaryLabel={`Apply to ${selectedCount} note${selectedCount === 1 ? "" : "s"}`}
      saving={saving}
      scope={`${selectedNoun} · staged changes apply together`}
      secondary={
        <button
          className="bulk-tag-clear"
          disabled={saving || union.length === 0}
          onClick={() => onClearAll(union.map((row) => row.name))}
          type="button"
        >
          Clear all tags…
        </button>
      }
      title="Tags"
    >
      <section className="bulk-tag-section">
        <span className="bulk-panel-label">Add a tag</span>
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
            Suggestions unavailable · the selection's own tags are still listed.
          </p>
        ) : null}
      </section>

      <section className="bulk-tag-section">
        <div className="bulk-tag-section-heading">
          <span className="bulk-panel-label">On these notes</span>
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
    </BulkPanel>
  );
}
