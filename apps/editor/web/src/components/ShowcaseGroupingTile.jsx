import { useState } from "react";

// The edit-only `+ create a grouping` tile. A Grouping takes a name only; the
// parent is the node the canvas is currently drilled into, so the tile appears
// only below a Category or a Grouping, never at the top level.
function ShowcaseGroupingTile({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        aria-label="Create a grouping"
        className="showcase-tile"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="showcase-tile-plus">
          +
        </span>
        create a grouping
      </button>
    );
  }

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
      setError(addError.message || "Could not add the grouping.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="showcase-category-combobox" onSubmit={handleSubmit}>
      <input
        aria-label="Grouping name"
        autoFocus
        className="showcase-category-input"
        onChange={(event) => setName(event.target.value)}
        value={name}
      />

      <div className="showcase-category-actions">
        <button
          className="button button-primary"
          disabled={busy || !name.trim()}
          type="submit"
        >
          Add grouping
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

export { ShowcaseGroupingTile };
