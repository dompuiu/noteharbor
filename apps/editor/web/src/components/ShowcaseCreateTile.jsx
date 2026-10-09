import { useState } from "react";

// Shared edit-only `+ create a …` tile. Clicking it reveals a name field; a
// Category tile also offers the shared label pool as combobox suggestions while
// a Grouping tile takes a name only. `noun` drives the rendered labels
// ("Create a category" / "create a category") and the error wording.
function ShowcaseCreateTile({
  noun,
  inputLabel,
  addLabel,
  suggestions = [],
  combobox = false,
  centered = false,
  onAdd,
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        aria-label={`Create a ${noun}`}
        className={`showcase-tile showcase-tile--create${centered ? " showcase-tile--centered" : ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="showcase-tile-plus">
          +
        </span>
        {`New ${noun}`}
      </button>
    );
  }

  const query = name.trim().toLowerCase();
  const visible = combobox
    ? suggestions.filter((suggestion) =>
        suggestion.name.toLowerCase().includes(query),
      )
    : [];

  function close() {
    setOpen(false);
    setName("");
    setError("");
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
        aria-autocomplete={combobox ? "list" : undefined}
        aria-expanded={combobox ? visible.length > 0 : undefined}
        aria-label={inputLabel}
        autoFocus
        className="showcase-category-input"
        onChange={(event) => setName(event.target.value)}
        role={combobox ? "combobox" : undefined}
        value={name}
      />

      {visible.length > 0 ? (
        <div className="showcase-category-options" role="listbox">
          {visible.map((suggestion) => (
            <button
              aria-selected={false}
              className="showcase-category-option"
              key={suggestion.id}
              onClick={() => setName(suggestion.name)}
              role="option"
              type="button"
            >
              {suggestion.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="showcase-category-actions">
        <button
          className="button button-primary"
          disabled={busy || !name.trim()}
          type="submit"
        >
          {addLabel}
        </button>
        <button className="button" onClick={close} type="button">
          Cancel
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
