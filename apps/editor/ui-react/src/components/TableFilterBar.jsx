import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { ChipRemoveButton } from "./ChipRemoveButton.jsx";
import { FilterFieldMenu } from "./FilterFieldMenu.jsx";
import { HighlightMatch, rankTagSuggestions } from "./TagsField.jsx";
import { TagSuggestionsToggle } from "./TagSuggestionsToggle.jsx";
import { tagsColumnKey } from "../lib/tableColumns.js";
import {
  computeFilterChipPlan,
  filterChipUnits,
} from "../lib/tableFilterChips.js";
import {
  commitModeLabel,
  loadFilterCommitMode,
  otherCommitMode,
  saveFilterCommitMode,
} from "../lib/filterCommitMode.js";
import {
  commitConditions,
  defaultFilterField,
  filterFieldLabel,
  filterPlaceholderFor,
  maxRangeValues,
  parseFilterInput,
} from "../lib/tableFilters.js";

// The filter bar owns its draft. Typing, the field picker, tag suggestions and
// inline chip editing are local state, so a keystroke never re-renders the
// table body; only a committed chip reaches the table through
// `onConditionsChange`.
export const TableFilterBar = forwardRef(function TableFilterBar(
  {
    availableWidth = null,
    chipUnits: chipUnitsProp = null,
    conditions,
    defaultField = defaultFilterField,
    hasRows,
    onConditionsChange,
    onEscape = null,
    onFirstRow,
    searchColumns,
    tagNames,
  },
  ref,
) {
  const [filterField, setFilterField] = useState(defaultField);
  const [filterDraft, setFilterDraft] = useState("");
  const [rangeRefused, setRangeRefused] = useState(false);
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const [tagSuggestionPosition, setTagSuggestionPosition] = useState(null);
  const [editingConditionId, setEditingConditionId] = useState(null);
  const [conditionDraft, setConditionDraft] = useState("");
  const [commitMode, setCommitMode] = useState(loadFilterCommitMode);
  const [modeAnnouncement, setModeAnnouncement] = useState("");
  const searchInputRef = useRef(null);
  const fieldRef = useRef(null);
  const tagSuggestionListRef = useRef(null);

  const tagMatches = useMemo(
    () => rankTagSuggestions(tagNames, new Set(), filterDraft),
    [filterDraft, tagNames],
  );
  const trimmedTagDraft = filterDraft.trim();
  // The filter only suggests tags that some note already carries. Creating a
  // tag belongs to the note editor, so the filter list has no create arm.
  const tagListVisible =
    filterField === tagsColumnKey &&
    tagSuggestionOpen &&
    Boolean(tagSuggestionPosition);
  // The chips are one line. Each unit is one connector (or field label) plus
  // its chip, in table order. The Table screen hands the list down so the row
  // it plans and the row it paints are the same list; a caller without a rail
  // (the showcase picker) builds its own.
  const chipUnits = useMemo(
    () => chipUnitsProp ?? filterChipUnits(conditions),
    [chipUnitsProp, conditions],
  );
  const chipPlan = useMemo(
    () => computeFilterChipPlan(chipUnits, availableWidth),
    [availableWidth, chipUnits],
  );
  const visibleChipUnits = chipUnits.slice(0, chipPlan.visibleCount);
  const hiddenChipUnits = chipUnits.slice(chipPlan.visibleCount);

  useImperativeHandle(ref, () => ({
    focus() {
      searchInputRef.current?.focus();
    },
    reset() {
      setFilterDraft("");
      setRangeRefused(false);
      setEditingConditionId(null);
      setConditionDraft("");
      setFilterField(defaultField);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
    },
  }));

  useEffect(() => {
    if (filterField !== tagsColumnKey || !tagSuggestionOpen) {
      setTagSuggestionPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const input = searchInputRef.current;

      if (!input) {
        return;
      }

      const bounds = input.getBoundingClientRect();
      setTagSuggestionPosition({
        top: bounds.bottom + 6,
        left: bounds.left,
        width: Math.max(bounds.width, 220),
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [filterField, tagSuggestionOpen]);

  useEffect(() => {
    if (!tagListVisible) {
      return undefined;
    }

    const closeOnOutsidePress = (event) => {
      if (
        fieldRef.current?.contains(event.target) ||
        tagSuggestionListRef.current?.contains(event.target)
      ) {
        return;
      }

      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
    };

    document.addEventListener("mousedown", closeOnOutsidePress);
    return () => document.removeEventListener("mousedown", closeOnOutsidePress);
  }, [tagListVisible]);

  useEffect(() => {
    if (filterField !== tagsColumnKey) {
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
    }
  }, [filterField]);

  // A hidden column must not keep filtering: the table drops its chips, and
  // the field picker falls back to the default field.
  const visibleFieldKeys = searchColumns.map((column) => column.key).join(",");

  useEffect(() => {
    if (
      filterField !== "all" &&
      filterField !== defaultField &&
      !visibleFieldKeys.split(",").includes(filterField)
    ) {
      setFilterField(defaultField);
    }
  }, [defaultField, filterField, visibleFieldKeys]);

  // Commit is explicit: Enter turns the field text into chips through the
  // latched mode. Replace (the default) swaps the committed field's chips and
  // keeps every other field; Add widens the same-field OR. A range wider than
  // the cap refuses the commit and keeps the draft, so the reader can shorten
  // it instead of losing it.
  function commitFilterDraft(raw = filterDraft) {
    const { conditions: parsed, tooWide } = parseFilterInput(filterField, raw);

    if (tooWide) {
      setRangeRefused(true);
      return;
    }

    setRangeRefused(false);

    if (!parsed.length) {
      return;
    }

    onConditionsChange((current) =>
      commitConditions(current, filterField, parsed, commitMode),
    );
    setFilterDraft("");
    closeTagSuggestions();
  }

  // Flipping is sticky and does not commit: the draft and the tag list stay,
  // and focus returns to the input so typing can continue without a click.
  function toggleCommitMode() {
    const nextMode = otherCommitMode(commitMode);
    setCommitMode(nextMode);
    saveFilterCommitMode(nextMode);
    setModeAnnouncement(`Commit mode: ${commitModeLabel(nextMode)}`);
    searchInputRef.current?.focus();
  }

  function openTagSuggestions(index = -1) {
    setTagSuggestionOpen(true);
    setTagSuggestionIndex(index);
  }

  function closeTagSuggestions() {
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
  }

  function scrollTagSuggestionIntoView(element) {
    // jsdom has no scrollIntoView; the guard keeps highlight paint working
    // there while a browser scrolls the option into view.
    element?.scrollIntoView?.({ block: "nearest" });
  }

  // A suggestion fills the Tags chip directly. Unknown tags are not offered
  // here: creating one is the note editor's job.
  function pickTagSuggestion(tag) {
    commitFilterDraft(tag);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeCondition(id) {
    onConditionsChange((current) =>
      current.filter((condition) => condition.id !== id),
    );
  }

  function clearAllFilters() {
    onConditionsChange([]);
  }

  function startConditionEdit(condition) {
    setEditingConditionId(condition.id);
    setConditionDraft(`${condition.negated ? "!" : ""}${condition.value}`);
  }

  function cancelConditionEdit() {
    setEditingConditionId(null);
    setConditionDraft("");
  }

  function commitConditionEdit() {
    if (editingConditionId == null) {
      return;
    }

    const id = editingConditionId;
    const raw = conditionDraft.trim();
    setEditingConditionId(null);
    setConditionDraft("");

    onConditionsChange((current) => {
      const negated = raw.startsWith("!");
      const value = (negated ? raw.slice(1) : raw).trim();

      if (!value) {
        return current.filter((condition) => condition.id !== id);
      }

      return current.map((condition) =>
        condition.id === id ? { ...condition, value, negated } : condition,
      );
    });
  }

  function handOffToRows(event) {
    event.preventDefault();

    if (hasRows) {
      onFirstRow?.();
    } else {
      event.currentTarget.blur();
    }
  }

  function handleSearchKeyDown(event) {
    const tagsField = filterField === tagsColumnKey;

    // The tags list opens on demand: typing opens it, and so does a plain
    // Down. The other fields keep handing a plain Down to the first row.
    if (
      tagsField &&
      !event.shiftKey &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();

      if (!tagSuggestionOpen) {
        if (event.key === "ArrowDown") {
          openTagSuggestions(tagMatches.length ? 0 : -1);
        }
        return;
      }

      if (!tagMatches.length) {
        return;
      }

      setTagSuggestionIndex((current) => {
        const step = event.key === "ArrowDown" ? 1 : -1;

        if (current < 0) {
          return event.key === "ArrowDown" ? 0 : tagMatches.length - 1;
        }

        return (current + step + tagMatches.length) % tagMatches.length;
      });
      return;
    }

    // Shift+Enter latches the other mode on every field, including while the
    // tag list is open: it must never be mistaken for a suggestion pick. The
    // latch keeps the draft and does not commit. Auto-repeat would flip the
    // mode many times while the key is held, so it is swallowed.
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();

      if (!event.repeat) {
        toggleCommitMode();
      }

      return;
    }

    const tagListOpen =
      tagsField && tagSuggestionOpen && tagMatches.length > 0;

    if (
      tagListOpen &&
      event.key === "Enter" &&
      tagSuggestionIndex >= 0 &&
      tagMatches[tagSuggestionIndex]
    ) {
      event.preventDefault();
      pickTagSuggestion(tagMatches[tagSuggestionIndex]);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitFilterDraft();
      return;
    }

    if (tagListOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTagSuggestions();
      return;
    }

    if (event.key === "ArrowDown" && !event.shiftKey) {
      // Plain Down hands off to the first row; Shift+Down stays in the field.
      handOffToRows(event);
      return;
    }

    if (event.key === "Escape") {
      // A dialog-owned bar dismisses the dialog from its own field; the Table
      // hands the cursor to the first row instead.
      if (onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }

      // Escape leaves the field without clearing the draft or reaching the
      // table's row/anchor Escape handling. Like ArrowDown, it lands on the
      // first row so the table has a visible cursor to continue from.
      event.stopPropagation();
      handOffToRows(event);
    }
  }

  const filterPlaceholder = filterPlaceholderFor(filterField);
  // The mode control's accessible name states both ends; the title names the
  // pointer and keyboard routes to the same flip.
  const nextModeLabel = commitModeLabel(otherCommitMode(commitMode));
  const modeButtonName = `Switch commit mode to ${nextModeLabel} (currently ${commitModeLabel(commitMode)})`;
  // While typing the visible word is `flip`, so the name has to contain it too:
  // speech input can only find the control by what it reads.
  const flipButtonName = `Flip: switch commit mode to ${nextModeLabel} (currently ${commitModeLabel(commitMode)})`;
  const modeButtonTitle = `Click or Shift+Enter to switch to ${nextModeLabel}`;
  const modeButtonProps = {
    className: "table-filter-mode",
    onClick: toggleCommitMode,
    onMouseDown: (event) => event.preventDefault(),
    title: modeButtonTitle,
    type: "button",
  };

  // One chip plus the prefix that names it: the field label for a field's
  // first chip, "or" after it, and "and" ahead of a new field. The prefix
  // travels with the chip, so the popover's list still reads as groups and a
  // chip is never separated from the word that introduces it.
  function renderChipUnit({ condition, field, groupIndex, index }) {
    return (
      <span className="table-filter-unit" key={condition.id}>
        {groupIndex > 0 && index === 0 ? (
          <span className="table-filter-and">and</span>
        ) : null}
        {index > 0 ? (
          <span className="table-filter-or">or</span>
        ) : (
          <span className="table-filter-facet-label">
            {filterFieldLabel(field)}
          </span>
        )}
        <span
          className={`table-filter-chip${condition.negated ? " table-filter-chip--negated" : ""}`}
        >
          {editingConditionId === condition.id ? (
            <input
              aria-label={`Edit ${filterFieldLabel(field)} filter`}
              autoFocus
              className="table-filter-chip-input"
              onBlur={commitConditionEdit}
              onChange={(event) => setConditionDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitConditionEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelConditionEdit();
                }
              }}
              value={conditionDraft}
            />
          ) : (
            <>
              {/* The chip clips a long value, so its tooltip carries the whole
                  of it — and still says the chip is a control, which a bare
                  value does not. */}
              <button
                aria-label={`Edit ${filterFieldLabel(field)} filter ${condition.value}`}
                className="table-filter-chip-value"
                onClick={() => startConditionEdit(condition)}
                title={`Edit ${filterFieldLabel(field)} filter: ${condition.value}`}
                type="button"
              >
                {condition.negated ? "!" : ""}
                {condition.value}
              </button>
              <ChipRemoveButton
                label={`Remove ${filterFieldLabel(field)} ${condition.negated ? "not " : ""}${condition.value}`}
                onClick={() => removeCondition(condition.id)}
              />
            </>
          )}
        </span>
      </span>
    );
  }

  return (
    <Fragment>
      <div className="table-search table-search--scoped" ref={fieldRef}>
        <svg
          aria-hidden="true"
          className="table-search-icon"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.9"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <FilterFieldMenu
          onChange={(field) => {
            setFilterField(field);
            searchInputRef.current?.focus();
          }}
          options={[
            { key: "all", label: filterFieldLabel("all") },
            ...searchColumns.map((column) => ({
              key: column.key,
              label: filterFieldLabel(column.key),
            })),
          ]}
          value={filterField}
        />
        <span aria-hidden="true" className="table-search-divider" />
        <input
          aria-autocomplete={
            filterField === tagsColumnKey ? "list" : undefined
          }
          aria-controls={
            tagListVisible ? "table-filter-tag-suggestions" : undefined
          }
          aria-expanded={
            filterField === tagsColumnKey ? tagListVisible : undefined
          }
          aria-label={`Filter ${filterFieldLabel(filterField)}`}
          autoComplete="off"
          className="table-search-input"
          onBlur={
            filterField === tagsColumnKey
              ? () => closeTagSuggestions()
              : undefined
          }
          onChange={(event) => {
            setFilterDraft(event.target.value);
            setRangeRefused(false);

            if (filterField === tagsColumnKey) {
              openTagSuggestions();
            }
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder={filterPlaceholder}
          ref={searchInputRef}
          type="search"
          value={filterDraft}
        />
        {filterField === tagsColumnKey ? (
          // The list opens on demand: this chevron sits before the shortcut
          // and says "press Down to see the suggestions".
          <TagSuggestionsToggle
            className="table-filter-tags-toggle"
            controlsId="table-filter-tag-suggestions"
            expanded={tagListVisible}
            onClick={() => {
              if (tagSuggestionOpen) {
                closeTagSuggestions();
              } else {
                openTagSuggestions();
              }
              searchInputRef.current?.focus();
            }}
            strokeWidth={2.4}
          />
        ) : null}
        {rangeRefused ? (
          // The refusal takes the commit hint's slot and height, so a rejected
          // range says why without moving the table.
          <span className="table-filter-note" role="status">
            Up to {maxRangeValues} values per range
          </span>
        ) : filterDraft.trim() ? (
          // While typing the hint names the commit and the latch together: the
          // mode word stays plain and `flip` is the button.
          <span className="table-filter-enter">
            <kbd className="table-search-hint">⏎</kbd> {commitMode}
            <span aria-hidden="true">·</span>
            <button aria-label={flipButtonName} {...modeButtonProps}>
              flip
            </button>
            <kbd className="table-search-hint">⇧⏎</kbd>
          </span>
        ) : (
          // At rest the mode reads before the `/` keycap, so the field states
          // what ⏎ will do before anything is typed.
          <Fragment>
            <button aria-label={modeButtonName} {...modeButtonProps}>
              <svg
                aria-hidden="true"
                className="table-filter-mode-icon"
                fill="none"
                focusable="false"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 12 12"
              >
                <path d="M1 4h8.5L7.5 2M11 8H2.5L4.5 10" />
              </svg>
              {commitMode}
            </button>
            <kbd className="table-search-hint">/</kbd>
          </Fragment>
        )}
      </div>
      {/* A mode flip moves focus back to the input, so the change needs its
          own polite announcement: the page never re-reads the button. */}
      <p
        aria-atomic="true"
        aria-live="polite"
        className="table-filter-mode-announcer"
      >
        {modeAnnouncement}
      </p>
      {tagListVisible
        ? createPortal(
            <div
              aria-label="Tag suggestions"
              className="tags-filter-dropdown"
              id="table-filter-tag-suggestions"
              ref={tagSuggestionListRef}
              role="listbox"
              style={{
                top: tagSuggestionPosition.top,
                left: tagSuggestionPosition.left,
                width: tagSuggestionPosition.width,
              }}
            >
              {tagMatches.map((tag, index) => (
                <button
                  aria-selected={index === tagSuggestionIndex}
                  className={`tags-filter-option${index === tagSuggestionIndex ? " is-highlighted" : ""}`}
                  key={tag}
                  onClick={() => pickTagSuggestion(tag)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setTagSuggestionIndex(index)}
                  ref={
                    index === tagSuggestionIndex
                      ? scrollTagSuggestionIntoView
                      : undefined
                  }
                  role="option"
                  type="button"
                >
                  <HighlightMatch text={tag} query={trimmedTagDraft} />
                </button>
              ))}
              {!tagMatches.length ? (
                <div
                  className="muted"
                  style={{ padding: "6px 8px", fontSize: "0.82rem" }}
                >
                  No matching tags.
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {chipUnits.length ? (
        <div className="table-filter-chips">
          {visibleChipUnits.map(renderChipUnit)}
          {hiddenChipUnits.length ? (
            <AnchoredPopover
              className="table-filter-chips--popover"
              initialFocus={(panel) =>
                panel.querySelector("button:not([disabled])")
              }
              panelLabel="More filters"
              renderTrigger={({ open, triggerProps }) => (
                <button
                  {...triggerProps}
                  aria-label={`+${hiddenChipUnits.length} more filter${hiddenChipUnits.length === 1 ? "" : "s"}`}
                  className={`table-filter-more${open ? " table-filter-more--open" : ""}`}
                  title={`Show the other ${hiddenChipUnits.length} filter${hiddenChipUnits.length === 1 ? "" : "s"}`}
                  type="button"
                >
                  +{hiddenChipUnits.length}
                </button>
              )}
            >
              {hiddenChipUnits.map(renderChipUnit)}
            </AnchoredPopover>
          ) : null}
          <button
            className="table-filter-clear-all"
            onClick={clearAllFilters}
            type="button"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </Fragment>
  );
});
