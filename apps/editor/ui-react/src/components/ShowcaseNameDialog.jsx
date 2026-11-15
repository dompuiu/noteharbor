import { useState } from "react";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";

// The one name form: adding a grouping after an item, or renaming a grouping
// or category in place. Both write immediately, so there is no draft Save.
function ShowcaseNameDialog({
  initialValue = "",
  label = "Name",
  onSubmit,
  onClose,
  submitLabel = "Save",
  subtitle = "",
  title,
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = value.trim();

  async function submit(event) {
    event.preventDefault();

    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onSubmit(trimmed);
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || "Could not save the name.");
      setBusy(false);
    }
  }

  return (
    <ShowcaseDialog onClose={onClose} subtitle={subtitle} title={title}>
      <form className="showcase-name-dialog" onSubmit={submit}>
        <label className="field-block">
          <span>{label}</span>
          <input
            aria-label={label}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.target.select?.()}
            value={value}
          />
        </label>

        {error ? (
          <p className="showcase-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="showcase-shell-form-actions">
          <button className="button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={!trimmed || busy}
            type="submit"
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </ShowcaseDialog>
  );
}

export { ShowcaseNameDialog };
