import { useId, useRef, useState } from "react";
import { HighlightMatch, rankTagSuggestions } from "./TagsField.jsx";

// Shared edit-only `+ create a …` tile. Clicking it reveals a name field; a
// Category tile also offers the shared label pool as combobox suggestions while
// a Grouping tile takes a name only. `noun` drives the rendered labels
// ("Create a category" / "create a category") and the error wording.
// `closedLabel` overrides both the closed button's accessible name and its
// visible text (the grouping tile reads `+ Add grouping`).
//
// The category field is a single-value combobox in the TagsField's visual and
// interaction language: the list stays shut until ArrowUp/Down, typing, or
// double-click opens it, the pool is ranked starts-with-first, Enter picks
// the highlight, Escape closes the list. Picking fills the
// field only — staging still waits for the Add button.
function ShowcaseCreateTile({
  noun,
  inputLabel,
  addLabel,
  closedLabel = null,
  suggestions = [],
  combobox = false,
  centered = false,
  onAdd,
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);
  const listboxId = useId();

  if (!open) {
    return (
      <button
        aria-label={closedLabel ?? `Create a ${noun}`}
        className={`showcase-tile showcase-tile--create${centered ? " showcase-tile--centered" : ""}`}
        onClick={() => {
          setOpen(true);
          setIsOpen(false);
          setHighlighted(-1);
        }}
        type="button"
      >
        <span aria-hidden="true" className="showcase-tile-plus">
          +
        </span>
        {closedLabel ?? `New ${noun}`}
      </button>
    );
  }

  const names = suggestions.map((suggestion) => suggestion.name);
  const rankedNames = combobox
    ? rankTagSuggestions(names, new Set(), name)
    : [];
  const rankedByName = new Map(rankedNames.map((ranked, index) => [ranked, index]));
  const visible = combobox
    ? [...suggestions]
        .filter((suggestion) => rankedByName.has(suggestion.name))
        .sort(
          (left, right) =>
            rankedByName.get(left.name) - rankedByName.get(right.name),
        )
    : [];
  const listOpen = combobox && isOpen && visible.length > 0;
  const activeDescendantId =
    listOpen && highlighted >= 0 && visible[highlighted]
      ? `${listboxId}-option-${highlighted}`
      : undefined;

  function close() {
    setOpen(false);
    setName("");
    setError("");
    setHighlighted(-1);
    setIsOpen(false);
  }

  function pick(pickedName) {
    setName(pickedName);
    setIsOpen(false);
    setHighlighted(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
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
    if (event.key === "Enter" && isOpen && highlighted >= 0 && visible[highlighted]) {
      // A highlighted suggestion wins over the form submit: picking fills
      // the field so the user can review it before pressing Add.
      event.preventDefault();
      pick(visible[highlighted].name);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setHighlighted(-1);
      return;
    }
    if (event.key === "Tab" && isOpen) {
      setIsOpen(false);
      setHighlighted(-1);
    }
  }

  function scrollHighlightedIntoView(element) {
    // jsdom (tests) has no scrollIntoView; the guard keeps the highlight
    // paint working there while browsers still scroll the option into view.
    element?.scrollIntoView?.({ block: "nearest" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onAdd(trimmed);
      close();
    } catch (addError) {
      setError(addError.message || `Could not add the ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`showcase-category-combobox${centered ? " showcase-category-combobox--centered" : ""}`}
      onSubmit={handleSubmit}
    >
      <input
        aria-activedescendant={combobox ? activeDescendantId : undefined}
        aria-autocomplete={combobox ? "list" : undefined}
        aria-controls={combobox && listOpen ? listboxId : undefined}
        aria-expanded={combobox ? listOpen : undefined}
        aria-label={inputLabel}
        autoFocus
        className="showcase-category-input"
        onChange={(event) => {
          setName(event.target.value);
          setIsOpen(true);
          setHighlighted(-1);
        }}
        onDoubleClick={() => {
          if (combobox) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        role={combobox ? "combobox" : undefined}
        value={name}
      />

      {listOpen ? (
        <div
          className="showcase-category-options"
          id={listboxId}
          role="listbox"
          aria-label={`${noun} suggestions`}
        >
          {visible.map((suggestion, index) => (
            <button
              aria-selected={index === highlighted}
              className={`showcase-category-option${index === highlighted ? " is-highlighted" : ""}`}
              id={`${listboxId}-option-${index}`}
              key={suggestion.id}
              onClick={() => pick(suggestion.name)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              ref={
                index === highlighted ? scrollHighlightedIntoView : undefined
              }
              role="option"
              type="button"
            >
              <HighlightMatch text={suggestion.name} query={name} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="showcase-category-actions">
        <button className="button" onClick={close} type="button">
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={busy || !name.trim()}
          type="submit"
        >
          {addLabel}
        </button>
      </div>

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export { ShowcaseCreateTile };
