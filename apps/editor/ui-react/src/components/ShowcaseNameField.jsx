import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingList } from "../lib/useFloatingList.js";
import { normalizeTag } from "../lib/tags.js";
import { MenuIcon } from "./MenuIcon.jsx";
import { HighlightMatch, rankTagSuggestions } from "./TagsField.jsx";

// The name field shared by the showcase's create and rename dialogs. With a
// suggestion pool it behaves like the table's tag field: the pool is ranked
// starts-with-first, the list stays shut until ArrowUp/Down or typing, Enter
// picks the highlighted name, and Escape falls through to the dialog. An
// unplaced pool label also carries a delete action, so the pool can be pruned
// from the same list that offers it.
function ShowcaseNameField({
  deletingSuggestionId = null,
  label,
  onChange,
  onDelete,
  suggestions = [],
  suggestionsLabel = "Name suggestions",
  value,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const listboxId = useId();

  const combobox = suggestions.length > 0;
  const rankedNames = combobox
    ? rankTagSuggestions(
        suggestions.map((suggestion) => suggestion.name),
        new Set(),
        value,
        suggestions.length,
      )
    : [];
  const suggestionsByName = new Map(
    suggestions.map((suggestion) => [normalizeTag(suggestion.name), suggestion]),
  );
  const visible = rankedNames
    .map((name) => suggestionsByName.get(normalizeTag(name)))
    .filter(Boolean);
  const listOpen = combobox && isOpen && visible.length > 0;
  const position = useFloatingList(listOpen, inputRef);

  useEffect(() => {
    if (!listOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (
        !inputRef.current?.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
        setHighlighted(-1);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [listOpen]);

  const activeDescendantId =
    listOpen && highlighted >= 0 && visible[highlighted]
      ? `${listboxId}-option-${highlighted}`
      : undefined;

  function pick(pickedName) {
    onChange(pickedName);
    setIsOpen(false);
    setHighlighted(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function canDelete(suggestion) {
    // Older payloads may omit the count; treat an unknown count as unused so
    // the action stays reachable, and let the server reject a used label.
    return Boolean(onDelete) && (suggestion?.showcase_count ?? 0) === 0;
  }

  function showcaseUsage(suggestion) {
    return `${suggestion.showcase_count} ${
      suggestion.showcase_count === 1 ? "showcase" : "showcases"
    }`;
  }

  function suggestionLabel(suggestion) {
    return suggestion.showcase_count > 0
      ? `${suggestion.name}, placed in ${showcaseUsage(suggestion)}`
      : suggestion.name;
  }

  function deleteSuggestion(suggestion) {
    if (!canDelete(suggestion) || deletingSuggestionId != null) {
      return;
    }

    setHighlighted(-1);
    onDelete(suggestion);
  }

  function handleKeyDown(event) {
    if (!combobox) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);

      if (!visible.length) {
        return;
      }

      setHighlighted((current) => {
        if (current < 0) {
          return event.key === "ArrowDown" ? 0 : visible.length - 1;
        }

        const step = event.key === "ArrowDown" ? 1 : -1;
        return (current + step + visible.length) % visible.length;
      });
      return;
    }

    if (
      event.key === "Enter" &&
      isOpen &&
      highlighted >= 0 &&
      visible[highlighted]
    ) {
      // A highlighted suggestion wins over the form submit: picking fills the
      // field so the user can still review it before pressing the action.
      event.preventDefault();
      pick(visible[highlighted].name);
      return;
    }

    if (event.key === "Delete" && isOpen && highlighted >= 0) {
      const target = visible[highlighted];

      if (canDelete(target)) {
        event.preventDefault();
        deleteSuggestion(target);
      }
      return;
    }

    if (event.key === "Tab" && isOpen) {
      setIsOpen(false);
      setHighlighted(-1);
    }
  }

  function scrollHighlightedIntoView(element) {
    // jsdom has no scrollIntoView; browsers scroll the highlighted option.
    element?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <>
      <label className="field-block">
        <span>{label}</span>
        <input
          aria-activedescendant={combobox ? activeDescendantId : undefined}
          aria-autocomplete={combobox ? "list" : undefined}
          aria-controls={listOpen ? listboxId : undefined}
          aria-expanded={combobox ? listOpen : undefined}
          aria-label={label}
          autoFocus
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
            setHighlighted(-1);
          }}
          onDoubleClick={() => {
            if (combobox) {
              setIsOpen(true);
            }
          }}
          onFocus={(event) => event.target.select?.()}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          role={combobox ? "combobox" : undefined}
          value={value}
        />
      </label>

      {listOpen && position
        ? createPortal(
            <div
              aria-label={suggestionsLabel}
              className="tags-filter-dropdown showcase-name-suggestions"
              id={listboxId}
              ref={dropdownRef}
              role="listbox"
              style={{
                position: "fixed",
                top: position.top,
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
            >
              {visible.map((suggestion, index) => (
                <div
                  className="showcase-name-suggestion"
                  key={suggestion.id}
                  role="presentation"
                >
                  <button
                    aria-label={suggestionLabel(suggestion)}
                    aria-selected={index === highlighted}
                    className={`tags-filter-option${index === highlighted ? " is-highlighted" : ""}`}
                    id={`${listboxId}-option-${index}`}
                    onClick={() => pick(suggestion.name)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlighted(index)}
                    ref={
                      index === highlighted ? scrollHighlightedIntoView : undefined
                    }
                    role="option"
                    type="button"
                  >
                    <HighlightMatch text={suggestion.name} query={value} />
                  </button>

                  {canDelete(suggestion) ? (
                    <button
                      aria-keyshortcuts="Delete"
                      aria-label={`Delete ${suggestion.name} from the category pool`}
                      className="showcase-name-suggestion-delete"
                      disabled={deletingSuggestionId != null}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSuggestion(suggestion);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      title="Delete from the category pool"
                      type="button"
                    >
                      <MenuIcon
                        className="showcase-name-suggestion-delete-icon"
                        name="delete"
                      />
                    </button>
                  ) : typeof suggestion.showcase_count === "number" &&
                    suggestion.showcase_count > 0 ? (
                    <span className="tags-filter-option-count">
                      {showcaseUsage(suggestion)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export { ShowcaseNameField };
