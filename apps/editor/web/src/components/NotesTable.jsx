import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  deleteNote,
  getNotes,
  getOperationStatus,
  reorderNotes as saveNotesOrder,
  getScrapeStatus,
  startScrape,
} from "../lib/api.js";
import { isScrapingDisabled } from "../lib/appMode.js";
import { copyTextToClipboard, formatNoteAsTsvRow } from "../lib/noteClipboard.js";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { Slideshow } from "./Slideshow.jsx";

export function HomeHero() {
  return null;
}

const baseColumns = [
  ["denomination", "Denomination"],
  ["issue_date", "Date"],
  ["catalog_number", "Catalog #"],
  ["grading_company", "Company"],
  ["grade", "Grade"],
  ["serial", "Serial"],
  ["tags", "Tags"],
];
const scrapeStatusColumn = ["scrape_status", "Scraped"];
const columns = [
  ...baseColumns,
  ["scrape_status", "Scraped"],
];

const selectCountOptions = [5, 10, 25, 50];
const tableStateStorageKey = "noteharbor.notesTableState";
const validSortKeys = new Set(["id", ...columns.map(([key]) => key)]);
const rowHeightEstimate = 43;
const validPreviewKinds = new Set(["front", "back"]);
const tagChipHorizontalPadding = 20;
const tagListGap = 8;
const tagChipMeasureSafetyMargin = 2;
const tagsPopoverWidth = 280;
const tagsPopoverMaxHeight = 320;
const tagsPopoverOpenDelay = 300;
const tagsPopoverCloseDelay = 150;

let tagTextMeasureContext = null;

function getTagTextMeasureContext() {
  if (tagTextMeasureContext || typeof document === "undefined") {
    return tagTextMeasureContext;
  }

  const probe = document.createElement("button");
  probe.className = "tag";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.textContent = "x";
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
  document.body.removeChild(probe);

  tagTextMeasureContext = context;
  return tagTextMeasureContext;
}

function measureTagChipWidth(text) {
  const context = getTagTextMeasureContext();

  if (!context) {
    return text.length * 8 + tagChipHorizontalPadding;
  }

  return (
    Math.ceil(context.measureText(text).width) +
    tagChipHorizontalPadding +
    tagChipMeasureSafetyMargin
  );
}

function computeVisibleTagPlan(tags, availableWidth) {
  if (!tags.length) {
    return { visibleTags: [], hiddenTags: [] };
  }

  const chipWidths = tags.map((tag) => measureTagChipWidth(tag.name));
  const fullWidth = chipWidths.reduce(
    (sum, width, index) => sum + width + (index > 0 ? tagListGap : 0),
    0,
  );

  if (fullWidth <= availableWidth) {
    return { visibleTags: tags, hiddenTags: [] };
  }

  for (let visibleCount = tags.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const hiddenCount = tags.length - visibleCount;
    let width = measureTagChipWidth(`+${hiddenCount}`);

    for (let i = 0; i < visibleCount; i += 1) {
      width += chipWidths[i] + tagListGap;
    }

    // At visibleCount 0 we always accept, so the "+N" counter is never
    // itself pushed out of view with no indicator left behind.
    if (width <= availableWidth || visibleCount === 0) {
      return {
        visibleTags: tags.slice(0, visibleCount),
        hiddenTags: tags.slice(visibleCount),
      };
    }
  }
}

// Anchors the popover under `bounds` (the trigger's rect), flipping above it
// when there isn't room below, given the popover's (real or estimated) height.
function computePopoverTop(bounds, height) {
  const spaceBelow = window.innerHeight - bounds.bottom - 6;
  const spaceAbove = bounds.top - 6;

  return spaceBelow >= height || spaceBelow >= spaceAbove
    ? Math.min(bounds.bottom + 6, window.innerHeight - height - 8)
    : Math.max(8, bounds.top - height - 6);
}

function TagsCell({ onApplyFilter, tags }) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const openTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const popoverHeightRef = useRef(null);

  useLayoutEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return undefined;
    }

    setAvailableWidth(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setAvailableWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      popoverHeightRef.current = null;
      return undefined;
    }

    function updatePosition() {
      const trigger = triggerRef.current;

      if (!trigger) {
        setIsOpen(false);
        return;
      }

      const bounds = trigger.getBoundingClientRect();
      const maxLeft = window.innerWidth - tagsPopoverWidth - 8;
      const left = Math.max(8, Math.min(bounds.left, maxLeft));

      // Before the popover has mounted (and given us a real height to
      // measure), fall back to its max possible height so the first paint
      // still avoids running off-screen; the layout effect below corrects
      // `top` using the real height as soon as it's known.
      const height =
        popoverHeightRef.current ?? Math.min(tagsPopoverMaxHeight, window.innerHeight - 16);
      const top = computePopoverTop(bounds, height);

      setPopoverPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // The first pass above has to guess the popover's height, since it hasn't
  // rendered yet. Once it has, re-derive `top` from its actual height so a
  // short tag list doesn't get positioned as if it were the max height.
  useLayoutEffect(() => {
    if (!isOpen || !popoverPosition || !popoverRef.current) {
      return;
    }

    const measuredHeight = popoverRef.current.getBoundingClientRect().height;

    if (popoverHeightRef.current === measuredHeight) {
      return;
    }

    popoverHeightRef.current = measuredHeight;

    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const bounds = trigger.getBoundingClientRect();
    const top = computePopoverTop(bounds, measuredHeight);

    setPopoverPosition((current) => (current ? { ...current, top } : current));
  }, [isOpen, popoverPosition]);

  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) {
        clearTimeout(openTimeoutRef.current);
      }

      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  function cancelScheduledOpen() {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }

  function cancelScheduledClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function handleTriggerMouseEnter() {
    cancelScheduledClose();
    cancelScheduledOpen();
    openTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, tagsPopoverOpenDelay);
  }

  function handleMouseLeave() {
    cancelScheduledOpen();
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, tagsPopoverCloseDelay);
  }

  function handleMouseEnterAgain() {
    cancelScheduledClose();
  }

  function handleTriggerFocus() {
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen(true);
  }

  function handleTriggerMouseDown(event) {
    // Clicking an unfocused button fires a native focus event before click.
    // Without this, handleTriggerFocus's setIsOpen(true) and this same
    // click's toggle in handleTriggerClick cancel each other out.
    event.preventDefault();
  }

  function handleTriggerClick(event) {
    event.stopPropagation();
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen((current) => !current);
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "Tab" && !event.shiftKey && isOpen) {
      const firstButton = popoverRef.current?.querySelector("button");

      if (firstButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }
  }

  function handlePopoverFocus() {
    cancelScheduledClose();
  }

  function handlePopoverKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "Tab") {
      const buttons = Array.from(popoverRef.current?.querySelectorAll("button") ?? []);
      const atLast = !event.shiftKey && document.activeElement === buttons[buttons.length - 1];
      const atFirst = event.shiftKey && document.activeElement === buttons[0];

      if (atLast || atFirst) {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
  }

  const { visibleTags, hiddenTags } = !tags.length
    ? { visibleTags: [], hiddenTags: [] }
    : availableWidth == null
      ? { visibleTags: tags, hiddenTags: [] }
      : computeVisibleTagPlan(tags, availableWidth);

  return (
    <div className="tag-list tag-list-clip" ref={containerRef}>
      {!tags.length ? <span className="muted">-</span> : null}
      {visibleTags.map((tag) => (
        <button
          className="tag"
          key={tag.id || tag.name}
          onClick={(event) => {
            event.stopPropagation();
            onApplyFilter(tag.name, { replace: event.shiftKey });
          }}
          title={tag.name}
          type="button"
        >
          {tag.name}
        </button>
      ))}
      {hiddenTags.length ? (
        <span className="tag-more-wrap">
          <button
            aria-label={`${hiddenTags.length} more tags`}
            className="tag tag-more"
            onBlur={handleMouseLeave}
            onClick={handleTriggerClick}
            onFocus={handleTriggerFocus}
            onKeyDown={handleTriggerKeyDown}
            onMouseDown={handleTriggerMouseDown}
            onMouseEnter={handleTriggerMouseEnter}
            onMouseLeave={handleMouseLeave}
            ref={triggerRef}
            type="button"
          >
            +{hiddenTags.length}
          </button>
          {isOpen && popoverPosition
            ? createPortal(
                <div
                  className="tag-popover"
                  onBlur={handleMouseLeave}
                  onFocus={handlePopoverFocus}
                  onKeyDown={handlePopoverKeyDown}
                  onMouseEnter={handleMouseEnterAgain}
                  onMouseLeave={handleMouseLeave}
                  ref={popoverRef}
                  style={{ top: popoverPosition.top, left: popoverPosition.left }}
                >
                  {hiddenTags.map((tag) => (
                    <button
                      className="tag"
                      key={tag.id || tag.name}
                      onClick={(event) => {
                        event.stopPropagation();
                        onApplyFilter(tag.name, { replace: event.shiftKey });
                        setIsOpen(false);
                      }}
                      title={tag.name}
                      type="button"
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </span>
      ) : null}
    </div>
  );
}

const MultiValueFilterCombobox = forwardRef(function MultiValueFilterCombobox(
  {
    columnLabel,
    matchMode = "startsWith",
    onChange,
    onHeightChange,
    options,
    value,
  },
  forwardedRef,
) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const optionElementMapRef = useRef(new Map());

  useLayoutEffect(() => {
    const element = containerRef.current;

    if (!element || !onHeightChange) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      onHeightChange(element.offsetHeight);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    select: () => inputRef.current?.select(),
  }));

  const selectedValues = useMemo(
    () =>
      String(value ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean),
    [value],
  );

  const selectedLookup = useMemo(
    () => new Set(selectedValues.map((item) => item.toLowerCase())),
    [selectedValues],
  );

  const suggestions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();

    return options.filter((option) => {
      if (selectedLookup.has(option.toLowerCase())) {
        return false;
      }

      if (!query) {
        return true;
      }

      const normalizedOption = option.toLowerCase();
      return matchMode === "includes"
        ? normalizedOption.includes(query)
        : normalizedOption.startsWith(query);
    });
  }, [inputValue, matchMode, options, selectedLookup]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    if (highlightedIndex < 0) {
      return;
    }

    optionElementMapRef.current
      .get(highlightedIndex)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
      return undefined;
    }

    function handlePointerDown(event) {
      if (
        !containerRef.current?.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return undefined;
    }

    function updatePosition() {
      const element = containerRef.current;

      if (!element) {
        return;
      }

      const bounds = element.getBoundingClientRect();
      setDropdownPosition({ top: bounds.bottom + 4, left: bounds.left, width: bounds.width });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  function commitValues(nextValues) {
    onChange(nextValues.join(","));
  }

  function selectSuggestion(option) {
    commitValues([...selectedValues, option]);
    setInputValue("");
    inputRef.current?.focus();
  }

  function commitTypedValue() {
    const trimmed = inputValue.trim();

    if (!trimmed) {
      return;
    }

    const alreadySelected = selectedValues.some(
      (item) => item.toLowerCase() === trimmed.toLowerCase(),
    );

    if (!alreadySelected) {
      commitValues([...selectedValues, trimmed]);
    }

    setInputValue("");
    inputRef.current?.focus();
  }

  function removeValue(option) {
    commitValues(
      selectedValues.filter((item) => item.toLowerCase() !== option.toLowerCase()),
    );
    inputRef.current?.focus();
  }

  function clearAllValues() {
    commitValues([]);
    setInputValue("");
    setIsOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === "Backspace" && !inputValue && selectedValues.length) {
      removeValue(selectedValues[selectedValues.length - 1]);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (!suggestions.length) {
          return -1;
        }

        return current < 0 ? 0 : (current + 1) % suggestions.length;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        if (!suggestions.length) {
          return -1;
        }

        return current < 0
          ? suggestions.length - 1
          : (current - 1 + suggestions.length) % suggestions.length;
      });
      return;
    }

    if (event.key === "Enter") {
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        event.preventDefault();
        selectSuggestion(suggestions[highlightedIndex]);
        setIsOpen(false);
        return;
      }

      if (inputValue.trim()) {
        event.preventDefault();
        commitTypedValue();
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      if (isOpen) {
        setIsOpen(false);

        // Only swallow the key when the dropdown is actually visible, so an
        // Escape press with no suggestions on screen still reaches the
        // table's own "blur and focus a row" shortcut on the first press.
        if (suggestions.length) {
          event.stopPropagation();
        }
      }
      return;
    }
  }

  return (
    <div className="tags-filter-combobox" ref={containerRef}>
      <div className="tags-filter-chips-scroll">
        {selectedValues.map((item) => (
          <button
            aria-label={`Remove ${item} filter`}
            className="tags-filter-chip"
            key={item}
            onClick={() => removeValue(item)}
            type="button"
          >
            {item} ×
          </button>
        ))}
        {selectedValues.length >= 2 ? (
          <button
            aria-label={`Clear all ${columnLabel} filters`}
            className="tags-filter-clear-all"
            onClick={clearAllValues}
            title={`Clear all ${columnLabel} filters`}
            type="button"
          >
            Clear all
          </button>
        ) : null}
        <input
          aria-expanded={isOpen}
          aria-label={`Filter ${columnLabel}`}
          className="filter-input tags-filter-input"
          onChange={(event) => {
            setInputValue(event.target.value);
            setIsOpen(true);
          }}
          onDoubleClick={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          role="combobox"
          value={inputValue}
        />
      </div>
      {isOpen && suggestions.length && dropdownPosition
        ? createPortal(
            <div
              className="tags-filter-dropdown"
              ref={dropdownRef}
              role="listbox"
              style={{
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                width: dropdownPosition.width,
              }}
            >
              {suggestions.map((option, index) => (
                <button
                  className={`tags-filter-option${
                    index === highlightedIndex ? " is-highlighted" : ""
                  }`}
                  key={option}
                  onClick={() => selectSuggestion(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  ref={(element) => {
                    if (element) {
                      optionElementMapRef.current.set(index, element);
                    } else {
                      optionElementMapRef.current.delete(index);
                    }
                  }}
                  role="option"
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function loadSavedTableState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(tableStateStorageKey);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    const nextFilters =
      parsedValue.filters && typeof parsedValue.filters === "object"
        ? Object.fromEntries(
            Object.entries(parsedValue.filters)
              .filter(([key]) =>
                columns.some(([columnKey]) => columnKey === key),
              )
              .map(([key, value]) => [key, String(value ?? "")]),
          )
        : {};
    const nextSortKey = validSortKeys.has(parsedValue.sortKey)
      ? parsedValue.sortKey
      : "id";
    const nextSortDirection =
      parsedValue.sortDirection === "desc" ? "desc" : "asc";
    const nextSelectedIds = Array.isArray(parsedValue.selectedIds)
      ? parsedValue.selectedIds.filter(
          (value) => Number.isInteger(value) && value > 0,
        )
      : [];

    return {
      filters: nextFilters,
      selectedIds: [...new Set(nextSelectedIds)],
      sortKey: nextSortKey,
      sortDirection: nextSortDirection,
    };
  } catch {
    window.localStorage.removeItem(tableStateStorageKey);
    return null;
  }
}

function statusLabel(status) {
  if (!status) {
    return "pending";
  }

  return String(status).replace(/_/g, " ");
}

function statusIcon(status) {
  switch (status) {
    case "done":
      return "✓";
    case "manual":
      return "●";
    case "failed":
      return "✕";
    case "running":
      return "↻";
    case "queued":
      return "…";
    case "pending":
    case "idle":
    default:
      return "○";
  }
}

function activeScrapeJob(status) {
  return status?.status === "running" ? status : null;
}

function imageStatus(note) {
  const images = Array.isArray(note.images) ? note.images : [];

  if (!images.length) {
    return "pending";
  }

  if (images.some((image) => image.origin === "uploaded" || image.origin === "generated")) {
    return "manual";
  }

  if (images.every((image) => image.origin === "scraped")) {
    return "done";
  }

  return "pending";
}

function displayScrapeStatus(note, scrapeJob) {
  if (!scrapeJob) {
    return note.scrape_status === "failed" ? "failed" : imageStatus(note);
  }

  if (scrapeJob.currentNoteId === note.id) {
    return "running";
  }

  const item = (scrapeJob.items ?? []).find(
    (entry) => entry.noteId === note.id,
  );

  if (item?.status === "queued") {
    return "queued";
  }

  return note.scrape_status === "failed" ? "failed" : imageStatus(note);
}

function valueToString(note, key) {
  if (key === "tags") {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

function parseFilterValue(rawValue, normalizeValue) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) {
    return { negated: false, value: "" };
  }

  const negated = normalized.startsWith("!");
  const rawParsedValue = negated ? normalized.slice(1).trim() : normalized;
  const value = normalizeValue ? normalizeValue(rawParsedValue) : rawParsedValue;
  return value ? { negated, value } : { negated: false, value: "" };
}

function addThousandsSeparators(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeDenominationFilterValue(value) {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^(\d[\d,]*)(\.\d+)?(.*)$/);
  if (!match) {
    return trimmed;
  }

  const [, rawIntegerPart, decimalPart = "", suffix = ""] = match;
  const integerDigits = rawIntegerPart.replace(/,/g, "");
  if (!/^\d+$/.test(integerDigits)) {
    return trimmed;
  }

  return `${addThousandsSeparators(integerDigits)}${decimalPart}${suffix}`;
}

function parseScalarFilters(rawFilterValue, normalizeValue) {
  return String(rawFilterValue ?? "")
    .split(",")
    .map((value) => parseFilterValue(value, normalizeValue))
    .filter(({ value }) => value);
}

function matchesSingleFilterValue(noteValue, filterValue, matchMode = "includes") {
  return matchMode === "catalogPrefix"
    ? matchesCatalogFilterValue(noteValue, filterValue)
    : matchMode === "startsWith"
      ? noteValue.startsWith(filterValue)
      : noteValue.includes(filterValue);
}

function matchesFilterValue(noteValue, rawFilterValue, matchMode = "includes", options = {}) {
  const normalizedNoteValue = String(noteValue ?? "").toLowerCase();
  const filters = options.multiple
    ? parseScalarFilters(rawFilterValue, options.normalizeFilterValue)
    : [parseFilterValue(rawFilterValue, options.normalizeFilterValue)].filter(({ value }) => value);

  if (!filters.length) {
    return true;
  }

  const positiveFilters = filters.filter(({ negated }) => !negated);
  const negativeFilters = filters.filter(({ negated }) => negated);

  if (positiveFilters.length) {
    const hasPositiveMatch = positiveFilters.some(({ value }) =>
      matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
    );
    if (!hasPositiveMatch) {
      return false;
    }
  }

  return negativeFilters.every(
    ({ value }) => !matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
  );
}

function matchesCatalogFilterValue(noteValue, filterValue) {
  if (!noteValue.startsWith(filterValue)) {
    return false;
  }

  const nextCharacter = noteValue.charAt(filterValue.length);
  return !nextCharacter || !/\d/.test(nextCharacter);
}

function matchesTagFilter(note, rawFilterValue) {
  const filters = parseScalarFilters(rawFilterValue);

  if (!filters.length) {
    return true;
  }

  const noteTagNames = note.tags.map((tag) =>
    String(tag.name ?? "").trim().toLowerCase(),
  );
  return filters.every(({ negated, value }) => {
    const hasMatch = noteTagNames.some((tagName) => tagName.startsWith(value));
    return negated ? !hasMatch : hasMatch;
  });
}

function noteOrderValue(note) {
  const value = Number(note.display_order);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function versionedImagePath(path, version) {
  if (!path) {
    return null;
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

function pickImage(note, type, variant = "full") {
  const imagePath =
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(imagePath, note.updated_at);
}

function pickFirstAvailableImage(note, slots) {
  for (const [type, variant] of slots) {
    const imagePath = pickImage(note, type, variant);
    if (imagePath) {
      return { path: imagePath, type, variant };
    }
  }

  return null;
}

function parsePositiveInteger(value) {
  const parsedValue = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function emptyTableRoute() {
  return {
    beforeId: null,
    kind: "table",
    noteId: null,
    overlayEdit: false,
    previewKind: null,
  };
}

function parseTableHash(hash) {
  const normalizedHash = String(hash ?? "").replace(/^#/, "");

  if (!normalizedHash) {
    return emptyTableRoute();
  }

  const [rawPath, rawQuery = ""] = normalizedHash.split("?");
  const segments = rawPath.split("/").filter(Boolean);
  const params = new URLSearchParams(rawQuery);

  if (segments[0] === "new") {
    return {
      ...emptyTableRoute(),
      beforeId: parsePositiveInteger(params.get("before")),
      kind: "create",
    };
  }

  if (segments[0] === "edit") {
    const noteId = parsePositiveInteger(segments[1]);
    return noteId
      ? {
          ...emptyTableRoute(),
          kind: "edit",
          noteId,
        }
      : emptyTableRoute();
  }

  if (segments[0] === "slideshow") {
    const noteId = parsePositiveInteger(segments[1]);

    if (!noteId) {
      return emptyTableRoute();
    }

    const previewKind =
      segments[2] === "preview" && segments[3]
        ? String(segments[3]).toLowerCase()
        : null;

    return {
      ...emptyTableRoute(),
      kind: "slideshow",
      noteId,
      overlayEdit: params.get("overlay") === "edit",
      previewKind,
    };
  }

  return emptyTableRoute();
}

function buildTableHash(route) {
  if (!route || route.kind === "table") {
    return "";
  }

  if (route.kind === "create") {
    const params = new URLSearchParams();

    if (route.beforeId) {
      params.set("before", String(route.beforeId));
    }

    const query = params.toString();
    return `#new${query ? `?${query}` : ""}`;
  }

  if (route.kind === "edit" && route.noteId) {
    return `#edit/${route.noteId}`;
  }

  if (route.kind === "slideshow" && route.noteId) {
    const params = new URLSearchParams();
    let path = `#slideshow/${route.noteId}`;

    if (route.previewKind) {
      path += `/preview/${route.previewKind}`;
    }

    if (route.overlayEdit) {
      params.set("overlay", "edit");
    }

    const query = params.toString();
    return `${path}${query ? `?${query}` : ""}`;
  }

  return "";
}

function NotesTable({
  activeCollection,
  activeCollectionId,
  collections,
  collectionsError,
  loadingCollections,
  onSelectCollection,
}) {
  const initialTableStateRef = useRef(undefined);
  const initialRouteRef = useRef(
    typeof window === "undefined"
      ? emptyTableRoute()
      : parseTableHash(window.location.hash),
  );
  const rowElementMapRef = useRef(new Map());
  const thumbPreviewElementMapRef = useRef(new Map());
  const dragPreviewRef = useRef(null);
  const tableShellRef = useRef(null);
  const editorOverlayRef = useRef(null);
  const tagsFilterInputRef = useRef(null);
  const firstFilterInputRef = useRef(null);
  const focusedRowIdRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
  const pendingRowFocusNoteIdRef = useRef(null);
  const focusRestoreNoteIdRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  if (initialTableStateRef.current === undefined) {
    initialTableStateRef.current = loadSavedTableState();
  }

  const [notes, setNotes] = useState([]);
  const [filters, setFilters] = useState(
    () => initialTableStateRef.current?.filters ?? {},
  );
  const [sortKey, setSortKey] = useState(
    () => initialTableStateRef.current?.sortKey ?? "id",
  );
  const [sortDirection, setSortDirection] = useState(
    () => initialTableStateRef.current?.sortDirection ?? "asc",
  );
  const [selectedIds, setSelectedIds] = useState(
    () => initialTableStateRef.current?.selectedIds ?? [],
  );
  const [selectNextCount, setSelectNextCount] = useState(10);
  const [bulkAction, setBulkAction] = useState(
    isScrapingDisabled ? "delete" : "scrape",
  );
  const [scrapeJob, setScrapeJob] = useState(null);
  const [operationStatus, setOperationStatus] = useState({
    currentOperation: "idle",
    isBusy: false,
  });
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [moveToast, setMoveToast] = useState("");
  const moveToastTimerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [thumbPreviewState, setThumbPreviewState] = useState(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [columnFilterHeights, setColumnFilterHeights] = useState({});
  const selectAllRef = useRef(null);

  useEffect(() => {
    return () => {
      if (moveToastTimerRef.current) {
        clearTimeout(moveToastTimerRef.current);
      }
    };
  }, []);

  const showSelection = true;
  const showReorder = true;
  const showActions = true;
  const visibleColumns = useMemo(
    () => (isScrapingDisabled ? baseColumns : [...baseColumns, scrapeStatusColumn]),
    [],
  );
  const showScrapeStatusColumn = visibleColumns.some(
    ([key]) => key === "scrape_status",
  );
  const filterRowHeight = Object.keys(columnFilterHeights).length
    ? Math.max(32, ...Object.values(columnFilterHeights))
    : null;
  const allTagNames = useMemo(() => {
    const seen = new Map();

    notes.forEach((note) => {
      note.tags.forEach((tag) => {
        const name = String(tag.name ?? "").trim();
        const key = name.toLowerCase();

        if (name && !seen.has(key)) {
          seen.set(key, name);
        }
      });
    });

    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [notes]);
  const currentRoute = useMemo(
    () => parseTableHash(location.hash),
    [location.hash],
  );
  const orderedNotes = useMemo(() => {
    const filtered = notes.filter((note) =>
      visibleColumns.every(([key]) => {
        if (key === "tags") {
          return matchesTagFilter(note, filters[key]);
        }

        if (key === "scrape_status") {
          return matchesFilterValue(
            displayScrapeStatus(note, scrapeJob),
            filters[key],
            "includes",
          );
        }

        const supportsMultipleValues =
          key === "catalog_number" ||
          key === "grade" ||
          key === "issue_date" ||
          key === "denomination";

        return matchesFilterValue(
          valueToString(note, key),
          filters[key],
          key === "catalog_number" ? "catalogPrefix" : "includes",
          {
            multiple: supportsMultipleValues,
            normalizeFilterValue:
              key === "denomination" ? normalizeDenominationFilterValue : undefined,
          },
        );
      }),
    );

    return [...filtered].sort((left, right) => {
      if (sortKey === "id") {
        const orderResult = noteOrderValue(left) - noteOrderValue(right);
        const result = orderResult || left.id - right.id;
        return sortDirection === "asc" ? result : -result;
      }

      const leftValue = valueToString(left, sortKey).toLowerCase();
      const rightValue = valueToString(right, sortKey).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [filters, notes, scrapeJob, sortDirection, sortKey, visibleColumns]);
  const defaultOrderedNotes = useMemo(
    () =>
      [...notes].sort((left, right) => {
        const orderResult = noteOrderValue(left) - noteOrderValue(right);
        return orderResult || left.id - right.id;
      }),
    [notes],
  );
  const slideshowRouteActive = currentRoute.kind === "slideshow";
  const creatingNote = currentRoute.kind === "create";
  const editingNoteId =
    currentRoute.kind === "edit" || currentRoute.overlayEdit
      ? currentRoute.noteId
      : null;
  const createPositionReferenceId =
    creatingNote && currentRoute.beforeId && notes.some((note) => note.id === currentRoute.beforeId)
      ? currentRoute.beforeId
      : null;
  const createPositionMode = createPositionReferenceId ? "before" : "end";
  const slideshowIndex = slideshowRouteActive
    ? slideshowNotes.findIndex((note) => note.id === currentRoute.noteId)
    : -1;
  const editingNoteIndex = useMemo(() => {
    if (!editingNoteId) {
      return -1;
    }

    return orderedNotes.findIndex((note) => note.id === editingNoteId);
  }, [editingNoteId, orderedNotes]);
  const previousEditingNoteId =
    editingNoteIndex >= 0 && orderedNotes.length > 1
      ? orderedNotes[
          (editingNoteIndex - 1 + orderedNotes.length) % orderedNotes.length
        ].id
      : null;
  const nextEditingNoteId =
    editingNoteIndex >= 0 && orderedNotes.length > 1
      ? orderedNotes[(editingNoteIndex + 1) % orderedNotes.length].id
      : null;
  const currentEditingNotePosition =
    editingNoteIndex >= 0 ? editingNoteIndex + 1 : null;
  const totalNotesInTableView = orderedNotes.length;

  function navigateToTableRoute(nextRoute, { replace = false } = {}) {
    const nextHash = buildTableHash(nextRoute);
    const nextUrl = `${location.pathname}${nextHash}`;
    navigate(nextUrl || "/", { replace });
  }

  const totalColumnCount =
    visibleColumns.length +
    2 +
    (showSelection ? 1 : 0) +
    (showReorder ? 1 : 0) +
    (showActions ? 1 : 0);

  async function loadNotes() {
    if (!Number.isInteger(activeCollectionId)) {
      setNotes([]);
      return [];
    }

    const payload = await getNotes(activeCollectionId);
    setNotes(payload.notes);
    return payload.notes;
  }

  useEffect(() => {
    if (loadingCollections) {
      return;
    }

    if (!Number.isInteger(activeCollectionId)) {
      setLoading(false);
      setNotes([]);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError("");

    const initialLoad = isScrapingDisabled
      ? Promise.all([getNotes(activeCollectionId), getOperationStatus()]).then(([notesPayload, operationPayload]) => {
          if (active) {
            setNotes(notesPayload.notes);
            setScrapeJob(null);
            setOperationStatus(operationPayload);
          }
        })
      : Promise.all([getNotes(activeCollectionId), getScrapeStatus(), getOperationStatus()]).then(
          ([notesPayload, statusPayload, operationPayload]) => {
            if (active) {
              setNotes(notesPayload.notes);
              setScrapeJob(activeScrapeJob(statusPayload));
              setOperationStatus(operationPayload);
            }
          },
        );

    initialLoad
      .catch((fetchError) => {
        if (active) {
          setLoadError(fetchError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeCollectionId, loadingCollections]);

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => notes.some((note) => note.id === id)),
    );
  }, [notes]);

  useEffect(() => {
    setFilters({});
  }, [activeCollectionId]);

  useEffect(() => {
    if (isScrapingDisabled || (!operationStatus.isBusy && !scrapeJob)) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const [nextStatus, notesPayload, nextOperationStatus] = await Promise.all([
          getScrapeStatus(),
          getNotes(activeCollectionId),
          getOperationStatus(),
        ]);
        const nextScrapeJob = activeScrapeJob(nextStatus);

        setNotes(notesPayload.notes);
        setScrapeJob(nextScrapeJob);
        setOperationStatus(nextOperationStatus);
      } catch {
        // Ignore transient polling errors.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [activeCollectionId, operationStatus.isBusy, scrapeJob]);

  useEffect(() => {
    if (!slideshowRouteActive || !slideshowNotes.length) {
      return;
    }

    setSlideshowNotes((current) => {
      if (!current.length) {
        return current;
      }

      const notesById = new Map(notes.map((note) => [note.id, note]));
      const nextNotes = current
        .map((note) => notesById.get(note.id))
        .filter(Boolean);

      if (
        nextNotes.length === current.length &&
        nextNotes.every((note, index) => note === current[index])
      ) {
        return current;
      }

      return nextNotes;
    });
  }, [notes, slideshowNotes.length, slideshowRouteActive]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (currentRoute.kind === "table") {
      setSlideshowNotes([]);
      return;
    }

    if (currentRoute.kind === "create") {
      if (currentRoute.beforeId && !notes.some((note) => note.id === currentRoute.beforeId)) {
        navigateToTableRoute({ kind: "create" }, { replace: true });
      }

      setSlideshowNotes([]);
      return;
    }

    if (currentRoute.kind === "edit") {
      if (!notes.some((note) => note.id === currentRoute.noteId)) {
        navigateToTableRoute(emptyTableRoute(), { replace: true });
        return;
      }

      setSlideshowNotes([]);
      return;
    }

    const hasRestoredTableState = Boolean(initialTableStateRef.current);
    const baseNotes =
      initialRouteRef.current.kind === "slideshow" &&
      slideshowNotes.length === 0 &&
      !hasRestoredTableState
        ? defaultOrderedNotes
        : orderedNotes;
    const targetIndex = baseNotes.findIndex((note) => note.id === currentRoute.noteId);

    if (targetIndex < 0) {
      navigateToTableRoute(emptyTableRoute(), { replace: true });
      return;
    }

    setSlideshowNotes((current) => {
      if (
        current.length === baseNotes.length &&
        current.every((note, index) => note.id === baseNotes[index]?.id)
      ) {
        return current;
      }

      return baseNotes;
    });

    if (
      currentRoute.previewKind &&
      !validPreviewKinds.has(currentRoute.previewKind)
    ) {
      navigateToTableRoute(
        {
          kind: "slideshow",
          noteId: currentRoute.noteId,
          overlayEdit: currentRoute.overlayEdit,
          previewKind: null,
        },
        { replace: true },
      );
    }
  }, [
    currentRoute,
    defaultOrderedNotes,
    loading,
    notes,
    orderedNotes,
    slideshowNotes.length,
  ]);

  useEffect(() => {
    if (!editingNoteId && !creatingNote) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeEditor();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [creatingNote, editingNoteId]);

  useEffect(() => {
    if (!editingNoteId && !creatingNote) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (editorOverlayRef.current) {
        editorOverlayRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [creatingNote, editingNoteId]);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((value) => String(value).trim()),
    [filters],
  );
  const isDefaultOrder = sortKey === "id" && sortDirection === "asc";
  const canReorder =
    showReorder && !hasActiveFilters && isDefaultOrder && !reorderLoading;

  const allVisibleSelected = useMemo(
    () =>
      orderedNotes.length > 0 &&
      orderedNotes.every((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds],
  );
  const someVisibleSelected = useMemo(
    () => orderedNotes.some((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds],
  );
  const hasSavedTableState = useMemo(
    () =>
      hasActiveFilters ||
      sortKey !== "id" ||
      sortDirection !== "asc" ||
      selectedIds.length > 0,
    [hasActiveFilters, selectedIds, sortDirection, sortKey],
  );
  const rowVirtualizer = useVirtualizer({
    count: orderedNotes.length,
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => tableShellRef.current,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    window.localStorage.setItem(
      tableStateStorageKey,
      JSON.stringify({ filters, selectedIds, sortKey, sortDirection }),
    );
  }, [filters, selectedIds, sortDirection, sortKey]);

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [filters, rowVirtualizer, sortDirection, sortKey]);

  useEffect(() => {
    if (!thumbPreviewState) {
      return undefined;
    }

    const shell = tableShellRef.current;

    if (!shell) {
      return undefined;
    }

    function updateThumbPreviewPosition() {
      const thumbElement = thumbPreviewElementMapRef.current.get(
        thumbPreviewState.noteId,
      );

      if (!thumbElement) {
        setThumbPreviewState(null);
        return;
      }

      const shellBounds = shell.getBoundingClientRect();
      const thumbBounds = thumbElement.getBoundingClientRect();
      const headerBottom =
        shell.querySelector("thead")?.getBoundingClientRect().bottom ?? shellBounds.top;
      const previewHeight = 138;
      const desiredTop = thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
      const minTop = Math.max(shellBounds.top + 8, headerBottom + 8);
      const maxTop = shellBounds.bottom - previewHeight - 8;
      const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
      const offsetY = Math.round(clampedTop - desiredTop);

      setThumbPreviewState((current) =>
        current && current.noteId === thumbPreviewState.noteId
          ? current.offsetY === offsetY
            ? current
            : { ...current, offsetY }
          : current,
      );
    }

    updateThumbPreviewPosition();
    shell.addEventListener("scroll", updateThumbPreviewPosition, { passive: true });
    window.addEventListener("resize", updateThumbPreviewPosition);

    return () => {
      shell.removeEventListener("scroll", updateThumbPreviewPosition);
      window.removeEventListener("resize", updateThumbPreviewPosition);
    };
  }, [thumbPreviewState]);

  useEffect(() => {
    if (!slideshowRouteActive && focusRestoreNoteIdRef.current != null) {
      const noteId = focusRestoreNoteIdRef.current;
      focusRestoreNoteIdRef.current = null;
      focusRowByNoteId(noteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowRouteActive]);

  useEffect(() => {
    function handleGlobalKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (showShortcutsHelp) {
        return;
      }

      const editable =
        event.target instanceof HTMLElement &&
        (event.target.tagName === "INPUT" ||
          event.target.tagName === "TEXTAREA" ||
          event.target.tagName === "SELECT" ||
          event.target.isContentEditable);

      if (event.key === "?" && !editable) {
        event.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }

      if (slideshowRouteActive || editingNoteId || creatingNote) {
        return;
      }

      if (event.key === "/" && !editable) {
        event.preventDefault();
        firstFilterInputRef.current?.focus();
        firstFilterInputRef.current?.select();
        return;
      }

      if (editable) {
        if (event.key === "Escape" && event.target.closest("thead")) {
          event.preventDefault();
          // Land on the invisible anchor rather than jumping straight into
          // the table, so the user can then press the down arrow to enter
          // it themselves.
          tableFocusAnchorRef.current?.focus();
          focusedRowIdRef.current = null;
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        moveRowFocus(1);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        moveRowFocus(-1);
        return;
      }

      if (
        event.key === "Escape" &&
        event.target instanceof HTMLElement &&
        event.target.classList.contains("table-row-link")
      ) {
        event.preventDefault();
        // Focus the anchor right before the table (instead of just calling
        // blur()) so a following Tab press lands on the header's "select
        // all" checkbox rather than wherever the browser's default tab
        // order would otherwise resume from.
        tableFocusAnchorRef.current?.focus();
        focusedRowIdRef.current = null;
        return;
      }

      const focusedRowElement = focusedRowIdRef.current
        ? rowElementMapRef.current.get(focusedRowIdRef.current)
        : null;

      if (!focusedRowElement || document.activeElement !== focusedRowElement) {
        return;
      }

      const focusedNote = orderedNotes.find(
        (note) => note.id === focusedRowIdRef.current,
      );

      if (!focusedNote) {
        return;
      }

      if (event.key === "e") {
        event.preventDefault();
        openEditor(focusedNote.id);
        return;
      }

      if (event.key === "d") {
        event.preventDefault();
        void handleDeleteNote(focusedNote.id);
        return;
      }

      if (event.key === "c") {
        event.preventDefault();
        void handleCopyNoteDetails(focusedNote);
        return;
      }

      if (event.key === "a") {
        event.preventDefault();
        openCreateNoteBefore(focusedNote.id);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    creatingNote,
    editingNoteId,
    orderedNotes,
    rowVirtualizer,
    slideshowRouteActive,
    showShortcutsHelp,
  ]);

  function resetTableState() {
    setFilters({});
    setSortKey("id");
    setSortDirection("asc");
    if (showSelection) {
      setSelectedIds([]);
    }
  }

  function reportColumnFilterHeight(key, height) {
    setColumnFilterHeights((current) =>
      current[key] === height ? current : { ...current, [key]: height },
    );
  }

  function applyTagFilter(tagName, { replace = false } = {}) {
    setFilters((current) => {
      if (replace) {
        return { ...current, tags: tagName };
      }

      const existingTags = String(current.tags ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
      const alreadyIncluded = existingTags.some(
        (tag) => tag.toLowerCase() === tagName.toLowerCase(),
      );
      const nextTags = alreadyIncluded
        ? existingTags
        : [...existingTags, tagName];

      return {
        ...current,
        tags: nextTags.join(","),
      };
    });

    window.requestAnimationFrame(() => {
      tagsFilterInputRef.current?.focus();
    });
  }

  function showThumbPreview(noteId) {
    setThumbPreviewState({ noteId, offsetY: 0 });
  }

  function hideThumbPreview(noteId) {
    setThumbPreviewState((current) =>
      current?.noteId === noteId ? null : current,
    );
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc",
      );
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  function openSlideshow(startId) {
    setActionError("");
    const noteId = startId ?? orderedNotes[0]?.id ?? null;

    if (!noteId) {
      return;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind: null,
    });
  }

  function closeSlideshow() {
    focusRestoreNoteIdRef.current = currentRoute.noteId;
    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function focusRowByNoteId(noteId) {
    if (noteId == null) {
      return;
    }

    const element = rowElementMapRef.current.get(noteId);

    if (element) {
      element.focus();
      focusedRowIdRef.current = noteId;
      return;
    }

    const index = orderedNotes.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    pendingRowFocusNoteIdRef.current = noteId;
    rowVirtualizer.scrollToIndex(index, { align: "auto" });
  }

  function moveRowFocus(offset) {
    if (!orderedNotes.length) {
      return;
    }

    const currentIndex = orderedNotes.findIndex(
      (note) => note.id === focusedRowIdRef.current,
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      orderedNotes.length - 1,
    );

    focusRowByNoteId(orderedNotes[nextIndex].id);
  }

  function openEditor(noteId) {
    setActionError("");

    if (slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId,
        overlayEdit: true,
        previewKind: currentRoute.previewKind,
      });
      return;
    }

    navigateToTableRoute({ kind: "edit", noteId });
  }

  function openCreateNote() {
    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: null });
  }

  function openCreateNoteBefore(referenceNoteId) {
    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: referenceNoteId });
  }

  function closeEditor() {
    if (slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId: currentRoute.noteId,
        overlayEdit: false,
        previewKind: currentRoute.previewKind,
      }, { replace: true });
      return;
    }

    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function resetEditorOverlayScroll() {
    if (editorOverlayRef.current) {
      editorOverlayRef.current.scrollTop = 0;
    }
  }

  function navigateToAdjacentEdit(nextNoteId) {
    if (!nextNoteId) {
      return;
    }

    if (slideshowRouteActive) {
      navigateToTableRoute(
        {
          kind: "slideshow",
          noteId: nextNoteId,
          overlayEdit: true,
          previewKind: currentRoute.previewKind,
        },
        { replace: true },
      );
      return;
    }

    navigateToTableRoute({ kind: "edit", noteId: nextNoteId }, { replace: true });
  }

  function showMoveToast(message) {
    setMoveToast(message);

    if (moveToastTimerRef.current) {
      clearTimeout(moveToastTimerRef.current);
    }

    moveToastTimerRef.current = setTimeout(() => setMoveToast(""), 4000);
  }

  function handleSaveEditedNote(updatedNote, reorderedNotes, movedToCollection) {
    if (movedToCollection) {
      // The note now belongs to a different collection — it no longer
      // belongs in this view, so drop it instead of merging it in.
      setNotes((current) => current.filter((note) => note.id !== updatedNote.id));
      setSelectedIds((current) => current.filter((id) => id !== updatedNote.id));
      setSlideshowNotes((current) => current.filter((note) => note.id !== updatedNote.id));
      showMoveToast(`Moved to ${movedToCollection.name}.`);
    } else if (reorderedNotes) {
      setNotes(reorderedNotes);
      setSlideshowNotes((current) => {
        if (!current.length) {
          return current;
        }

        const slideshowIds = new Set(current.map((note) => note.id));
        return reorderedNotes.filter((note) => slideshowIds.has(note.id));
      });
    } else {
      setNotes((current) => {
        const noteExists = current.some((note) => note.id === updatedNote.id);

        if (noteExists) {
          return current.map((note) =>
            note.id === updatedNote.id ? updatedNote : note,
          );
        }

        return [...current, updatedNote];
      });
      setSlideshowNotes((current) => {
        if (!current.length) {
          return current;
        }

        const noteExists = current.some((note) => note.id === updatedNote.id);
        if (!noteExists) return current;

        return current.map((note) =>
          note.id === updatedNote.id ? updatedNote : note,
        );
      });
    }

    if (!movedToCollection && slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId: updatedNote.id,
        overlayEdit: false,
        previewKind: currentRoute.previewKind,
      }, { replace: true });
      return;
    }

    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function toggleNote(noteId) {
    setSelectedIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId],
    );
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(orderedNotes.map((note) => note.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedIds((current) => [
      ...new Set([...current, ...orderedNotes.map((note) => note.id)]),
    ]);
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function clearDragPreview() {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  }

  function clearDragState() {
    clearDragPreview();
    setDraggedNoteId(null);
    setDropTarget(null);
  }

  function autoScrollTableShell(event) {
    const shell = tableShellRef.current;

    if (!shell || draggedNoteId === null) {
      return;
    }

    const bounds = shell.getBoundingClientRect();
    const threshold = 56;
    const maxStep = 24;

    if (event.clientY < bounds.top + threshold) {
      const ratio = (bounds.top + threshold - event.clientY) / threshold;
      shell.scrollTop -= Math.ceil(maxStep * Math.min(1, ratio));
    } else if (event.clientY > bounds.bottom - threshold) {
      const ratio = (event.clientY - (bounds.bottom - threshold)) / threshold;
      shell.scrollTop += Math.ceil(maxStep * Math.min(1, ratio));
    }
  }

  function updateDropTarget(noteId, event) {
    const row = rowElementMapRef.current.get(noteId);

    if (!row) {
      return;
    }

    const bounds = row.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";

    setDropTarget((current) =>
      current?.noteId === noteId && current?.placement === placement
        ? current
        : { noteId, placement },
    );
  }

  async function handleReorder(targetNoteId, placement) {
    if (!canReorder || draggedNoteId === null) {
      clearDragState();
      return;
    }

    const startIndex = notes.findIndex((note) => note.id === draggedNoteId);
    const targetIndex = notes.findIndex((note) => note.id === targetNoteId);

    if (startIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
      clearDragState();
      return;
    }

    const previousNotes = notes;
    const nextNotes = [...notes];
    const [movedNote] = nextNotes.splice(startIndex, 1);
    const insertIndex =
      startIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
    nextNotes.splice(insertIndex, 0, movedNote);

    const reorderedNotes = nextNotes.map((note, index) => ({
      ...note,
      display_order: index + 1,
    }));

    setActionError("");
    setNotes(reorderedNotes);
    setReorderLoading(true);
    clearDragState();

    try {
      const payload = await saveNotesOrder(
        reorderedNotes.map((note) => note.id),
        activeCollectionId,
      );
      setNotes(payload.notes);
    } catch (reorderError) {
      setActionError(reorderError.message);
      setNotes(previousNotes);
    } finally {
      setReorderLoading(false);
    }
  }

  function selectNextUnscraped() {
    const nextIds = orderedNotes
      .filter((note) => note.scrape_status === "failed" || imageStatus(note) !== "done")
      .slice(0, selectNextCount)
      .map((note) => note.id);

    setSelectedIds(nextIds);
  }

  async function handleBulkAction() {
    if (!selectedIds.length || bulkLoading) {
      return;
    }

    setActionError("");
    setBulkLoading(true);

    try {
      if (bulkAction === "delete") {
        const shouldDelete = window.confirm(
          `Delete ${selectedIds.length} selected note${selectedIds.length === 1 ? "" : "s"}?`,
        );

        if (!shouldDelete) {
          return;
        }

        await Promise.all(selectedIds.map((id) => deleteNote(id, activeCollectionId)));
        await loadNotes();
        clearSelection();
        return;
      }

      if (isScrapingDisabled) {
        return;
      }

      if (operationStatus.isBusy) {
        throw new Error(
          `Scraping is unavailable while ${String(operationStatus.currentOperation).replace(/_/g, " ")} is in progress.`,
        );
      }

      const payload = await startScrape(selectedIds);
      setOperationStatus({
        currentOperation: "scraping",
        isBusy: true,
        startedAt: new Date().toISOString(),
        details: {
          total: payload.total,
        },
      });
      setScrapeJob({
        status: "running",
        total: payload.total,
        completed: 0,
        currentNoteId: null,
        items: notes
          .filter((note) => selectedIds.includes(note.id))
          .map((note) => ({
            noteId: note.id,
            label: [note.denomination, note.catalog_number, note.serial]
              .filter(Boolean)
              .join(" - "),
            status: "queued",
            error: null,
          })),
      });
      clearSelection();
    } catch (actionError) {
      setActionError(actionError.message);
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleDeleteNote(noteId) {
    const note = notes.find((entry) => entry.id === noteId);
    const noteLabel = note?.denomination || `note #${noteId}`;
    const shouldDelete = window.confirm(`Delete ${noteLabel}?`);

    if (!shouldDelete) {
      return;
    }

    setActionError("");

    try {
      await deleteNote(noteId, activeCollectionId);
      setNotes((current) => current.filter((entry) => entry.id !== noteId));
      setSelectedIds((current) => current.filter((id) => id !== noteId));
    } catch (deleteError) {
      setActionError(deleteError.message);
    }
  }

  async function handleCopyNoteDetails(note) {
    try {
      await copyTextToClipboard(formatNoteAsTsvRow(note));
      setActionError("");
    } catch {
      setActionError("Could not copy note details to clipboard.");
    }
  }

  function changeSlideshowIndex(updater) {
    if (!slideshowNotes.length || !slideshowRouteActive) {
      return;
    }

    const currentIndexValue = slideshowNotes.findIndex(
      (note) => note.id === currentRoute.noteId,
    );
    const resolvedIndex =
      typeof updater === "function" ? updater(currentIndexValue) : updater;
    const boundedIndex =
      ((resolvedIndex % slideshowNotes.length) + slideshowNotes.length) %
      slideshowNotes.length;
    const nextNote = slideshowNotes[boundedIndex];

    if (!nextNote) {
      return;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId: nextNote.id,
      overlayEdit: false,
      previewKind: null,
    });
  }

  function openPreview(noteId, previewKind) {
    if (!validPreviewKinds.has(previewKind)) {
      return;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind,
    });
  }

  function closePreview(noteId) {
    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind: null,
    }, { replace: true });
  }

  function movePreview(offset) {
    if (!slideshowRouteActive || !slideshowNotes.length || !currentRoute.previewKind) {
      return;
    }

    const direction = offset >= 0 ? 1 : -1;
    let nextNoteIndex = slideshowNotes.findIndex(
      (note) => note.id === currentRoute.noteId,
    );

    if (nextNoteIndex < 0) {
      return;
    }

    let nextItems = ["front", "back"].filter((kind) =>
      validPreviewKinds.has(kind),
    );
    let nextItemIndex = nextItems.findIndex((kind) => kind === currentRoute.previewKind);

    if (nextItemIndex < 0) {
      nextItemIndex = direction > 0 ? -1 : nextItems.length;
    }

    let remainingSteps = Math.abs(offset);

    while (remainingSteps > 0) {
      const candidateIndex = nextItemIndex + direction;

      if (candidateIndex >= 0 && candidateIndex < nextItems.length) {
        nextItemIndex = candidateIndex;
        remainingSteps -= 1;
        continue;
      }

      nextNoteIndex =
        (nextNoteIndex + direction + slideshowNotes.length) % slideshowNotes.length;
      nextItems = ["front", "back"];
      nextItemIndex = direction > 0 ? 0 : nextItems.length - 1;
      remainingSteps -= 1;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId: slideshowNotes[nextNoteIndex].id,
      overlayEdit: false,
      previewKind: nextItems[nextItemIndex],
    });
  }

  return (
    <section className="screen-stack">
      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      {slideshowRouteActive && slideshowNotes.length && slideshowIndex >= 0 ? (
        <Slideshow
          currentIndex={slideshowIndex}
          keyboardDisabled={Boolean(editingNoteId || creatingNote)}
          notes={slideshowNotes}
          onChangeIndex={changeSlideshowIndex}
          onClose={closeSlideshow}
          onCopy={setActionError}
          onEdit={openEditor}
          onOpenPreview={openPreview}
          onClosePreview={closePreview}
          onMovePreview={movePreview}
          previewKind={currentRoute.previewKind}
        />
      ) : null}

      {editingNoteId || creatingNote ? (
        <section
          className="edit-note-overlay"
          ref={editorOverlayRef}
        >
          <div
            className="edit-note-overlay-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <NoteEditForm
              selectedCollectionId={activeCollectionId}
              cancelLabel="Close"
              currentNotePosition={currentEditingNotePosition}
              initialPositionMode={createPositionMode}
              initialPositionReferenceId={createPositionReferenceId}
              nextNoteId={nextEditingNoteId}
              noteId={editingNoteId}
              onCancel={closeEditor}
              onNavigateNext={() => navigateToAdjacentEdit(nextEditingNoteId)}
              onNavigatePrevious={() =>
                navigateToAdjacentEdit(previousEditingNoteId)
              }
              onReady={resetEditorOverlayScroll}
              onSaveSuccess={handleSaveEditedNote}
              overlay
              previousNoteId={previousEditingNoteId}
              totalNotesInView={totalNotesInTableView}
            />
          </div>
        </section>
      ) : null}

      <div className="panel">
            <div className="panel-heading panel-heading--compact">
            <div className="panel-heading-copy">
              <p className="eyebrow">Romanian Paper Money Archive</p>
              <h2>Note Harbor Editor</h2>
              <p>
                Collection: <strong>{Number(activeCollection?.is_default) === 1 ? "★ " : ""}{activeCollection?.name ?? "-"}</strong>. {orderedNotes.length} notes in the current view.
                {showSelection && selectedIds.length
                  ? ` ${selectedIds.length} selected.`
                  : ""}
              </p>
            </div>
            <div className="inline-actions">
              <select
                aria-label="Active collection"
                className="select-input"
                disabled={loadingCollections || !collections.length}
                onChange={(event) => onSelectCollection(Number(event.target.value))}
                value={activeCollectionId ?? ""}
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {Number(collection.is_default) === 1 ? '★ ' : ''}{collection.name}
                  </option>
                ))}
              </select>
              <button
                aria-label="Add banknote"
                className="icon-link button-primary"
                onClick={openCreateNote}
                title="Add banknote"
                type="button"
              >
                Add banknote
              </button>
              <Link
                aria-label="Import or export"
                className="icon-link"
                title="Import / Export"
                to="/import"
              >
                Import / Export
              </Link>
              <button
                aria-label="Keyboard shortcuts"
                className="icon-link"
                data-shortcut="?"
                onClick={() => setShowShortcutsHelp(true)}
                title="Keyboard shortcuts (?)"
                type="button"
              >
                Shortcuts
              </button>
            </div>
          </div>

        {loadingCollections ? <p>Loading collections...</p> : null}
        {loading ? <p>Loading notes...</p> : null}
        {collectionsError ? <p className="error-text">{collectionsError}</p> : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {moveToast ? (
          <div className="scrape-toast scrape-toast--success" role="status">
            {moveToast}
          </div>
        ) : null}
        {operationStatus.isBusy ? (
          <p className="warning-text">
            Current operation: {String(operationStatus.currentOperation).replace(/_/g, " ")}.
          </p>
        ) : null}

        {!loading && !loadError ? (
          <>
            <div className="toolbar-row toolbar-row--table-controls">
              <div className="inline-select-group">
                {hasSavedTableState ? (
                  <button
                    className="button"
                    onClick={resetTableState}
                    type="button"
                  >
                    Reset filters, sorting, and selection
                  </button>
                ) : null}
                {!isScrapingDisabled ? (
                  <>
                    <select
                      aria-label="Select next count"
                      className="select-input"
                      onChange={(event) =>
                        setSelectNextCount(Number(event.target.value))
                      }
                      value={selectNextCount}
                    >
                      {selectCountOptions.map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button"
                      disabled={operationStatus.isBusy}
                      onClick={selectNextUnscraped}
                      type="button"
                    >
                      Select next unscraped
                    </button>
                  </>
                ) : null}
              </div>
              <p className="table-helper-text">
                {reorderLoading
                  ? "Saving manual order..."
                  : canReorder
                    ? "Drag rows from the handle to change the default order."
                    : "Reordering is available only in the default unfiltered view."}
                {" "}Press <kbd>/</kbd> to filter, <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> to browse rows, or{" "}
                <kbd>?</kbd> for shortcuts.
              </p>
              {selectedIds.length ? (
                <div className="inline-select-group inline-select-group--bulk">
                  <select
                    aria-label="Bulk action"
                    className="select-input"
                    onChange={(event) => setBulkAction(event.target.value)}
                    value={bulkAction}
                  >
                    {!isScrapingDisabled ? (
                      <option value="scrape">Scrape selected</option>
                    ) : null}
                    <option value="delete">Delete selected</option>
                  </select>
                  <button
                    className="button button-primary"
                    disabled={bulkLoading || operationStatus.isBusy || Boolean(scrapeJob)}
                    onClick={handleBulkAction}
                    type="button"
                  >
                    {bulkLoading ? "Working..." : "Apply"}
                  </button>
                </div>
              ) : null}
            </div>

            <div
              className="table-shell"
              onDragOver={autoScrollTableShell}
              ref={tableShellRef}
            >
              <span
                aria-hidden="true"
                className="table-focus-anchor"
                ref={tableFocusAnchorRef}
                tabIndex={-1}
              />
              <table>
                <thead>
                  <tr>
                    {showReorder ? <th className="drag-cell" /> : null}
                    {showSelection ? (
                      <th>
                        <input
                          aria-label="Select all visible rows"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                          ref={selectAllRef}
                          type="checkbox"
                        />
                      </th>
                    ) : null}
                    <th>
                      <button
                        className="sort-button"
                        onClick={() => toggleSort("id")}
                        type="button"
                      >
                        ID
                        {sortKey === "id" ? (
                          <span>{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                        ) : null}
                      </button>
                    </th>
                    <th>Front</th>
                    {visibleColumns.map(([key, label]) => (
                      <th
                        className={
                          key === "scrape_status"
                            ? "scrape-status-column"
                            : key === "tags"
                              ? "tags-column"
                              : undefined
                        }
                        key={key}
                      >
                        <button
                          className="sort-button"
                          onClick={() => toggleSort(key)}
                          type="button"
                        >
                          {label}
                          {sortKey === key ? (
                            <span>{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                          ) : null}
                        </button>
                      </th>
                    ))}
                    {showActions ? <th>Actions</th> : null}
                  </tr>
                  <tr>
                    {showReorder ? <th className="drag-cell" /> : null}
                    {showSelection ? <th /> : null}
                    <th />
                    <th />
                    {visibleColumns.map(([key, label], columnIndex) => {
                      const isTagsColumn = key === "tags";
                      const comboboxRef =
                        key === "tags"
                          ? tagsFilterInputRef
                          : columnIndex === 0
                            ? firstFilterInputRef
                            : undefined;

                      return (
                        <th
                          className={
                            [
                              key === "scrape_status" ? "scrape-status-column" : null,
                              isTagsColumn ? "tags-column" : null,
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          key={`${key}-filter`}
                        >
                          {isTagsColumn ? (
                            <MultiValueFilterCombobox
                              columnLabel={label}
                              onChange={(nextValue) =>
                                setFilters((current) => ({
                                  ...current,
                                  [key]: nextValue,
                                }))
                              }
                              onHeightChange={(height) =>
                                reportColumnFilterHeight(key, height)
                              }
                              options={allTagNames}
                              ref={comboboxRef}
                              value={filters[key] ?? ""}
                            />
                          ) : (
                            <input
                              aria-label={`Filter ${label}`}
                              className="filter-input"
                              ref={columnIndex === 0 ? firstFilterInputRef : undefined}
                              style={
                                filterRowHeight
                                  ? { height: filterRowHeight }
                                  : undefined
                              }
                              value={filters[key] ?? ""}
                              onChange={(event) =>
                                setFilters((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                            />
                          )}
                        </th>
                      );
                    })}
                    {showActions ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {topSpacerHeight ? (
                    <tr aria-hidden="true" className="table-spacer-row">
                      <td colSpan={totalColumnCount} style={{ height: topSpacerHeight }} />
                    </tr>
                  ) : null}
                  {!orderedNotes.length ? (
                    <tr className="table-empty-row">
                      <td className="table-empty-cell" colSpan={totalColumnCount}>
                        {notes.length
                          ? "No notes match the current view."
                          : "No notes are stored yet. Use Import / Export to import data or add your first banknote."}
                      </td>
                    </tr>
                  ) : null}
                  {virtualRows.map((virtualRow) => {
                    const note = orderedNotes[virtualRow.index];
                    const noteScrapeStatus = displayScrapeStatus(
                      note,
                      scrapeJob,
                    );
                    const displayImage = pickFirstAvailableImage(note, [
                      ["front", "thumbnail"],
                      ["front", "full"],
                      ["back", "thumbnail"],
                      ["back", "full"],
                    ]);
                    const frontThumb = displayImage?.path ?? null;
                    const frontPreview = displayImage?.path ?? null;
                    const showPlaceholderBefore =
                      dropTarget?.noteId === note.id &&
                      dropTarget.placement === "before";
                    const showPlaceholderAfter =
                      dropTarget?.noteId === note.id &&
                      dropTarget.placement === "after";

                    return (
                      <Fragment key={note.id}>
                        {showPlaceholderBefore ? (
                          <tr
                            className="table-drop-placeholder-row"
                            aria-hidden="true"
                          >
                            <td
                              className="table-drop-placeholder-cell"
                              colSpan={totalColumnCount}
                            >
                              <span className="table-drop-placeholder-line" />
                            </td>
                          </tr>
                        ) : null}
                        <tr
                          className={`table-row-link${draggedNoteId === note.id ? " table-row-link--dragging" : ""}`}
                          data-index={virtualRow.index}
                          key={note.id}
                          ref={(element) => {
                            if (element) {
                              rowElementMapRef.current.set(note.id, element);
                              rowVirtualizer.measureElement(element);

                              if (pendingRowFocusNoteIdRef.current === note.id) {
                                pendingRowFocusNoteIdRef.current = null;
                                element.focus();
                                focusedRowIdRef.current = note.id;
                              }
                            } else {
                              rowElementMapRef.current.delete(note.id);
                            }
                          }}
                          onFocus={() => {
                            focusedRowIdRef.current = note.id;
                          }}
                          onDragLeave={(event) => {
                            if (
                              !event.currentTarget.contains(event.relatedTarget)
                            ) {
                              setDropTarget((current) =>
                                current?.noteId === note.id ? null : current,
                              );
                            }
                          }}
                          onDragOver={(event) => {
                            if (!canReorder || draggedNoteId === null) {
                              return;
                            }

                            event.preventDefault();
                            updateDropTarget(note.id, event);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const nextPlacement =
                              dropTarget?.noteId === note.id
                                ? dropTarget.placement
                                : event.clientY <
                                    event.currentTarget.getBoundingClientRect()
                                      .top +
                                      event.currentTarget.getBoundingClientRect()
                                        .height /
                                        2
                                  ? "before"
                                  : "after";
                            void handleReorder(note.id, nextPlacement);
                          }}
                          onClick={() => {
                            openSlideshow(note.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openSlideshow(note.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          {showReorder ? (
                            <td
                              className={`drag-cell${canReorder ? " drag-cell--enabled" : ""}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {canReorder ? (
                                <button
                                  aria-label={`Move ${note.denomination}`}
                                  className="drag-handle"
                                  draggable={canReorder}
                                  onClick={(event) => event.stopPropagation()}
                                  onDragEnd={clearDragState}
                                  onDragStart={(event) => {
                                    const row = rowElementMapRef.current.get(
                                      note.id,
                                    );

                                    clearDragPreview();
                                    event.stopPropagation();
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "text/plain",
                                      String(note.id),
                                    );

                                    if (row) {
                                      const preview = row.cloneNode(true);
                                      preview.classList.add("table-drag-preview");
                                      preview.style.width = `${row.getBoundingClientRect().width}px`;
                                      document.body.appendChild(preview);
                                      dragPreviewRef.current = preview;
                                      event.dataTransfer.setDragImage(
                                        preview,
                                        24,
                                        24,
                                      );
                                    }

                                    setDraggedNoteId(note.id);
                                    setDropTarget({
                                      noteId: note.id,
                                      placement: "before",
                                    });
                                  }}
                                  type="button"
                                >
                                  <span
                                    className="drag-handle-dots"
                                    aria-hidden="true"
                                  >
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                          {showSelection ? (
                            <td onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select ${note.denomination}`}
                                checked={selectedIds.includes(note.id)}
                                onChange={() => toggleNote(note.id)}
                                type="checkbox"
                              />
                            </td>
                          ) : null}
                          <td>{note.display_order ?? "-"}</td>
                          <td>
                            {frontThumb ? (
                              <span
                                className="table-thumb-wrap"
                                onBlur={(event) => {
                                  if (!event.currentTarget.contains(event.relatedTarget)) {
                                    hideThumbPreview(note.id);
                                  }
                                }}
                                onFocus={() => showThumbPreview(note.id)}
                                onMouseEnter={() => showThumbPreview(note.id)}
                                onMouseLeave={() => hideThumbPreview(note.id)}
                                ref={(element) => {
                                  if (element) {
                                    thumbPreviewElementMapRef.current.set(note.id, element);
                                  } else {
                                    thumbPreviewElementMapRef.current.delete(note.id);
                                  }
                                }}
                              >
                                <img
                                  alt={`${note.denomination} front`}
                                  className="table-thumb"
                                  src={frontThumb}
                                />
                                {frontPreview ? (
                                  <span
                                    className={`table-thumb-preview${
                                      thumbPreviewState?.noteId === note.id
                                        ? " is-visible"
                                        : ""
                                    }`}
                                    style={{
                                      "--table-thumb-preview-offset": `${
                                        thumbPreviewState?.noteId === note.id
                                          ? thumbPreviewState.offsetY
                                          : 0
                                      }px`,
                                    }}
                                  >
                                    <img
                                      alt={`${note.denomination} preview`}
                                      src={frontPreview}
                                    />
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </td>
                          <td>
                            {note.url ? (
                              <a
                                href={note.url}
                                onClick={(event) => event.stopPropagation()}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {note.denomination}
                              </a>
                            ) : (
                              note.denomination
                            )}
                          </td>
                          <td>{note.issue_date}</td>
                          <td>{note.catalog_number}</td>
                          <td>{note.grading_company}</td>
                          <td>{note.grade}</td>
                          <td>{note.serial}</td>
                          <td className="tags-column">
                            <TagsCell onApplyFilter={applyTagFilter} tags={note.tags} />
                          </td>
                          {showScrapeStatusColumn ? (
                            <td className="scrape-status-column">
                              <span
                                aria-label={statusLabel(noteScrapeStatus)}
                                className={`scrape-badge scrape-badge--${noteScrapeStatus}`}
                                role="img"
                                title={statusLabel(noteScrapeStatus)}
                              >
                                {statusIcon(noteScrapeStatus)}
                              </span>
                            </td>
                          ) : null}
                          {showActions ? (
                            <td>
                              <div className="inline-actions">
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCopyNoteDetails(note);
                                  }}
                                  title="Copy note details"
                                  type="button"
                                  aria-label={`Copy ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="9" y="9" />
                                    <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="5" y="5" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openCreateNoteBefore(note.id);
                                  }}
                                  title="Insert note before this"
                                  type="button"
                                  aria-label={`Insert note before ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditor(note.id);
                                  }}
                                  title="Edit note"
                                  type="button"
                                  aria-label={`Edit ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M12 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteNote(note.id);
                                  }}
                                  title="Delete note"
                                  type="button"
                                  aria-label={`Delete ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M5 7h14" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M9 7V5h6v2" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                        {showPlaceholderAfter ? (
                          <tr
                            className="table-drop-placeholder-row"
                            aria-hidden="true"
                          >
                            <td
                              className="table-drop-placeholder-cell"
                              colSpan={totalColumnCount}
                            >
                              <span className="table-drop-placeholder-line" />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {bottomSpacerHeight ? (
                    <tr aria-hidden="true" className="table-spacer-row">
                      <td colSpan={totalColumnCount} style={{ height: bottomSpacerHeight }} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export { NotesTable };
