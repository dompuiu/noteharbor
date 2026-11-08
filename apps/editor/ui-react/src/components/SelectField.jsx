import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingList } from "../lib/useFloatingList.js";
import { HighlightMatch } from "./TagsField.jsx";
import { TagSuggestionsToggle } from "./TagSuggestionsToggle.jsx";

// The Editor's one select: the same combobox the "Add a tag" field draws —
// one 36px box, hairline, surface, 10px radius, accent focus ring, accent
// chevron and floating option list. It is a single-choice combobox, so the
// list is a closed set: typing filters it, but only a listed option can ever
// be committed. Blur, Escape and Tab put the current choice back.
function labelFor(options, value) {
  const match = options.find(
    (option) => String(option.value) === String(value ?? ""),
  );
  return match?.label ?? "";
}

function matches(options, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return options;
  }
  return options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  );
}

export function SelectField({
  ariaLabel = "Select",
  options = [],
  onChange,
  placeholder = "Select…",
  value,
  wrapperClassName = "",
}) {
  const selectedLabel = labelFor(options, value);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState(selectedLabel);
  const [filter, setFilter] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const optionId = (index) => `${listboxId}-option-${index}`;
  const filtered = matches(options, filter);
  const position = useFloatingList(
    isOpen,
    containerRef,
    Math.max(1, filtered.length) * 32 + 12,
  );

  // A closed field always shows the current choice, however the value moved
  // (a URL restore, a parent reset, or the choice just made).
  useEffect(() => {
    if (!isOpen) {
      setInput(selectedLabel);
      setFilter("");
    }
  }, [isOpen, selectedLabel]);

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

  function closeList() {
    setIsOpen(false);
  }

  function openList() {
    setIsOpen(true);
    setFilter("");
    setHighlighted(
      options.findIndex(
        (option) => String(option.value) === String(value ?? ""),
      ),
    );
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function choose(option) {
    onChange?.(option.value);
    setInput(option.label);
    setIsOpen(false);
  }

  function handleInputChange(event) {
    const next = event.target.value;
    const nextMatches = matches(options, next);
    setInput(next);
    setFilter(next);
    setIsOpen(true);
    setHighlighted(nextMatches.length ? 0 : -1);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      if (!filtered.length) {
        return;
      }
      setHighlighted((current) => {
        if (current < 0) {
          return event.key === "ArrowDown" ? 0 : filtered.length - 1;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (current + step + filtered.length) % filtered.length;
      });
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen) {
        event.preventDefault();
        openList();
        return;
      }
      event.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        choose(filtered[highlighted]);
      } else if (filtered.length === 1) {
        choose(filtered[0]);
      }
      return;
    }

    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
      }
      return;
    }

    if (event.key === "Tab") {
      closeList();
      return;
    }

    if ((event.key === "Home" || event.key === "End") && isOpen) {
      event.preventDefault();
      if (filtered.length) {
        setHighlighted(event.key === "Home" ? 0 : filtered.length - 1);
      }
    }
  }

  const scrollHighlightedIntoView = (element) => {
    // jsdom (tests) has no scrollIntoView; the guard keeps the highlight paint
    // working there while browsers still scroll the option into view.
    element?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <div
      className={`select-wrap${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      ref={containerRef}
    >
      <input
        aria-activedescendant={
          isOpen && highlighted >= 0 ? optionId(highlighted) : undefined
        }
        aria-autocomplete="list"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        autoComplete="off"
        className="select-input"
        onBlur={(event) => {
          if (dropdownRef.current?.contains(event.relatedTarget)) {
            return;
          }
          closeList();
        }}
        onChange={handleInputChange}
        onClick={() => {
          if (!isOpen) {
            openList();
          }
        }}
        onFocus={(event) => event.target.select()}
        onKeyDown={handleKeyDown}
        placeholder={selectedLabel ? undefined : placeholder}
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        value={input}
      />
      <TagSuggestionsToggle
        className="select-toggle"
        controlsId={listboxId}
        expanded={isOpen}
        label={`Show ${ariaLabel} options`}
        onClick={() => {
          if (isOpen) {
            closeList();
          } else {
            openList();
          }
        }}
      />
      {isOpen && position
        ? createPortal(
            <div
              aria-label={`${ariaLabel} options`}
              className="tags-filter-dropdown select-dropdown"
              id={listboxId}
              ref={dropdownRef}
              role="listbox"
              style={position}
            >
              {filtered.map((option, index) => {
                const selected =
                  String(option.value) === String(value ?? "");
                return (
                  <button
                    aria-selected={selected}
                    className={`tags-filter-option${index === highlighted ? " is-highlighted" : ""}${selected ? " is-selected" : ""}`}
                    id={optionId(index)}
                    key={`${String(option.value)}-${index}`}
                    onClick={() => choose(option)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlighted(index)}
                    ref={
                      index === highlighted
                        ? scrollHighlightedIntoView
                        : undefined
                    }
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <HighlightMatch text={option.label} query={filter} />
                  </button>
                );
              })}
              {!filtered.length ? (
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
    </div>
  );
}
