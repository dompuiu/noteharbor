import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const normalizeTag = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const tagKey = (value) => normalizeTag(value).toLowerCase();
const splitTagInput = (raw) =>
  String(raw ?? "")
    .split(",")
    .map(normalizeTag)
    .filter(Boolean);

function rankTagSuggestions(vocabulary, selectedKeys, query) {
  const normalizedQuery = normalizeTag(query).toLowerCase();
  const pool = vocabulary
    .map(normalizeTag)
    .filter(Boolean)
    .filter((tag) => !selectedKeys.has(tag.toLowerCase()));
  const matching = normalizedQuery
    ? pool.filter((tag) => tag.toLowerCase().includes(normalizedQuery))
    : pool;
  if (!normalizedQuery) {
    return matching.slice(0, 16);
  }
  const starts = [];
  const contains = [];
  for (const tag of matching) {
    (tag.toLowerCase().startsWith(normalizedQuery) ? starts : contains).push(
      tag,
    );
  }
  starts.sort();
  contains.sort();
  return [...starts, ...contains].slice(0, 16);
}

function HighlightMatch({ text, query }) {
  const needle = normalizeTag(query);
  if (!needle) {
    return text;
  }
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <span style={{ background: "var(--accent-soft)", borderRadius: 3 }}>
        {text.slice(index, index + needle.length)}
      </span>
      {text.slice(index + needle.length)}
    </>
  );
}

// Controlled tags field in the Table screen filter's visual language:
// chips + inline input in one box, portal dropdown anchored under it.
// No data fetching inside — the parent owns `vocabulary` and can refilter
// it from a server via `onSearch`.
export const TagsField = forwardRef(function TagsField(
  {
    ariaLabel = "Tags",
    emptyText = "",
    inputProps,
    label,
    maxLength,
    maxTags,
    onChange,
    onCreate,
    onHeightChange,
    onSearch,
    placeholder = "Type a tag and press Enter",
    value = [],
    vocabulary = [],
  },
  forwardedRef,
) {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [position, setPosition] = useState(null);
  const [notice, setNotice] = useState(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const autoId = useId();
  const inputId = inputProps?.id ?? autoId;

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    select: () => inputRef.current?.select(),
    // Commit from outside (e.g. a suggestion cloud below the field)
    // through the same dedupe/limit path as typing.
    add: (raw) => commitRaw(raw),
  }));

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || !onHeightChange) {
      return undefined;
    }
    onHeightChange(element.offsetHeight);
    const observer = new ResizeObserver(() => {
      onHeightChange(element.offsetHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    const timer = setTimeout(() => onSearch?.(normalizeTag(input)), 250);
    return () => clearTimeout(timer);
  }, [input, onSearch]);

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value]);
  const filtered = useMemo(
    () => rankTagSuggestions(vocabulary, selectedKeys, input),
    [vocabulary, selectedKeys, input],
  );
  const trimmed = normalizeTag(input);
  const vocabularyKeys = useMemo(
    () => new Set(vocabulary.map(tagKey)),
    [vocabulary],
  );
  const showCreate =
    Boolean(trimmed) &&
    !selectedKeys.has(trimmed.toLowerCase()) &&
    !vocabularyKeys.has(trimmed.toLowerCase());
  const navList = showCreate ? [...filtered, `__create:${trimmed}`] : filtered;

  useEffect(() => {
    setHighlighted(-1);
  }, [input]);

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return undefined;
    }
    const updatePosition = () => {
      const element = containerRef.current;
      if (!element) {
        return;
      }
      const bounds = element.getBoundingClientRect();
      setPosition({
        top: bounds.bottom + 4,
        left: bounds.left,
        width: bounds.width,
      });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (
        !containerRef.current?.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const focusInput = () => inputRef.current?.focus();

  function commitRaw(raw) {
    const parts = splitTagInput(raw);
    if (!parts.length) {
      return;
    }
    const fresh = [];
    const batchKeys = new Set();
    for (const part of parts) {
      const key = part.toLowerCase();
      if (maxLength != null && part.length > maxLength) {
        setNotice({
          kind: "error",
          text: `"${part}" is ${part.length}/${maxLength} characters — too long.`,
        });
        continue;
      }
      if (selectedKeys.has(key) || batchKeys.has(key)) {
        setNotice({
          kind: "duplicate",
          text: `"${part}" is already attached.`,
        });
        continue;
      }
      if (maxTags != null && value.length + fresh.length >= maxTags) {
        setNotice({
          kind: "error",
          text: `Limit reached — at most ${maxTags} tags. Remove one first.`,
        });
        break;
      }
      batchKeys.add(key);
      fresh.push(part);
    }
    if (!fresh.length) {
      return;
    }
    setNotice(null);
    onChange([...value, ...fresh]);
    const unknown = fresh.filter(
      (tag) => !vocabularyKeys.has(tag.toLowerCase()),
    );
    if (unknown.length) {
      onCreate?.(unknown);
    }
    setInput("");
    setHighlighted(-1);
    requestAnimationFrame(focusInput);
  }

  function removeTag(tag) {
    onChange(value.filter((item) => tagKey(item) !== tagKey(tag)));
    requestAnimationFrame(focusInput);
  }

  function pick(entry) {
    if (entry?.startsWith("__create:")) {
      commitRaw(trimmed);
    } else {
      commitRaw(entry ?? input);
    }
    setIsOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "Backspace" && !input && value.length) {
      event.preventDefault();
      removeTag(value[value.length - 1]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      if (!navList.length) {
        return;
      }
      setHighlighted((current) => {
        if (current < 0) {
          return event.key === "ArrowDown" ? 0 : navList.length - 1;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (current + step + navList.length) % navList.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (event.key === "Enter" && highlighted >= 0 && navList[highlighted]) {
        pick(navList[highlighted]);
      } else {
        pick();
      }
      return;
    }
    // Tab is intentionally not intercepted: it moves focus to the next
    // element, and the blur handler below closes the dropdown.
    if (event.key === "Escape") {
      if (isOpen) {
        setIsOpen(false);
        setHighlighted(-1);
        event.stopPropagation();
      }
    }
  }

  function handlePaste(event) {
    const text = event.clipboardData?.getData("text") ?? "";
    if (text.includes(",")) {
      event.preventDefault();
      commitRaw(input + text);
      setIsOpen(false);
    }
  }

  const scrollHighlightedIntoView = (element) => {
    if (element) {
      element.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div>
      {label ? (
        <label
          htmlFor={inputId}
          style={{ fontWeight: 700, display: "block", marginBottom: 6 }}
        >
          {label}
          {value.length && maxTags != null
            ? ` · ${value.length}/${maxTags}`
            : null}
        </label>
      ) : null}
      <div className="tags-filter-combobox" ref={containerRef}>
        <div className="tags-filter-chips-scroll">
          {value.length ? (
            value.map((tag) => (
              <button
                aria-label={`Remove ${tag}`}
                className="tags-filter-chip"
                key={tag}
                onClick={() => removeTag(tag)}
                type="button"
              >
                {tag} <span aria-hidden="true">×</span>
              </button>
            ))
          ) : (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {emptyText}
            </span>
          )}
          {value.length >= 2 ? (
            <button
              aria-label="Clear all tags"
              className="tags-filter-clear-all"
              onClick={() => {
                onChange([]);
                requestAnimationFrame(focusInput);
              }}
              title="Clear all tags"
              type="button"
            >
              Clear all
            </button>
          ) : null}
          <input
            {...inputProps}
            id={inputId}
            aria-expanded={isOpen}
            aria-label={label ?? ariaLabel}
            autoComplete="off"
            className="filter-input tags-filter-input"
            onChange={(event) => {
              setInput(event.target.value);
              setIsOpen(true);
            }}
            onDoubleClick={() => setIsOpen(true)}
            onBlur={(event) => {
              // Focus moving into the portaled dropdown (clicking a
              // suggestion) keeps it open; anything else closes it.
              if (dropdownRef.current?.contains(event.relatedTarget)) {
                return;
              }
              setIsOpen(false);
              setHighlighted(-1);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={value.length ? "" : placeholder}
            ref={inputRef}
            role="combobox"
            value={input}
          />
        </div>
      </div>
      {isOpen && position
        ? createPortal(
            <div
              className="tags-filter-dropdown"
              ref={dropdownRef}
              role="listbox"
              aria-label="Tag suggestions"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
              }}
            >
              {filtered.map((tag) => {
                const index = navList.indexOf(tag);
                return (
                  <button
                    aria-selected={index === highlighted}
                    className={`tags-filter-option${index === highlighted ? " is-highlighted" : ""}`}
                    key={tag}
                    onClick={() => pick(tag)}
                    onMouseEnter={() => setHighlighted(index)}
                    ref={
                      index === highlighted
                        ? scrollHighlightedIntoView
                        : undefined
                    }
                    role="option"
                    type="button"
                  >
                    <HighlightMatch text={tag} query={trimmed} />
                  </button>
                );
              })}
              {showCreate ? (
                <button
                  aria-selected={highlighted === filtered.length}
                  className={`tags-filter-option${highlighted === filtered.length ? " is-highlighted" : ""}`}
                  onClick={() => pick(`__create:${trimmed}`)}
                  onMouseEnter={() => setHighlighted(filtered.length)}
                  ref={
                    highlighted === filtered.length
                      ? scrollHighlightedIntoView
                      : undefined
                  }
                  role="option"
                  style={{
                    borderTop: "1px dashed var(--border-control)",
                    fontWeight: 700,
                  }}
                  type="button"
                >
                  + Create “{trimmed}”
                </button>
              ) : null}
              {!filtered.length && !showCreate ? (
                <div
                  className="muted"
                  style={{ padding: "6px 8px", fontSize: "0.82rem" }}
                >
                  No matches.
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {notice ? (
        <p
          aria-live="polite"
          className={
            notice.kind === "duplicate" ? "warning-text" : "error-text"
          }
          style={{ margin: "4px 0 0", fontSize: "0.82rem" }}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
});
