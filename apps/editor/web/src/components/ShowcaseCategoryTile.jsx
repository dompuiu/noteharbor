import { useState } from "react";

// The edit-only `+ create a category` tile. Clicking it reveals a combobox: the
// field lists the label pool as suggestions, and a typed name creates a new
// label. `onAdd(name)` does the get-or-create then places the label.
function ShowcaseCategoryTile({ categories, onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        aria-label="Create a category"
        className="showcase-tile"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="showcase-tile-plus">
          +
        </span>
        create a category
      </button>
    );
  }

  const query = name.trim().toLowerCase();
  const suggestions = categories.filter((category) =>
    category.name.toLowerCase().includes(query),
  );

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
      setError(addError.message || "Could not add the category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="showcase-category-combobox" onSubmit={handleSubmit}>
      <input
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-label="Category name"
        autoFocus
        className="showcase-category-input"
        onChange={(event) => setName(event.target.value)}
        role="combobox"
        value={name}
      />

      {suggestions.length > 0 ? (
        <div className="showcase-category-options" role="listbox">
          {suggestions.map((category) => (
            <button
              aria-selected={false}
              className="showcase-category-option"
              key={category.id}
              onClick={() => setName(category.name)}
              role="option"
              type="button"
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="showcase-category-actions">
        <button className="button button-primary" disabled={busy || !name.trim()} type="submit">
          Add category
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

export { ShowcaseCategoryTile };
