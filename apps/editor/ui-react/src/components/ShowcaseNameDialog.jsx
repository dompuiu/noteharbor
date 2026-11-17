import { useState } from "react";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";
import { ShowcaseNameField } from "./ShowcaseNameField.jsx";

// The one name form used to create a category or grouping and to rename either
// in place. Both actions write immediately, so there is no draft Save; the
// `suggestions` pool turns the field into a pool picker for a new category.
function ShowcaseNameDialog({
  initialValue = "",
  label = "Name",
  onSubmit,
  onClose,
  submitLabel = "Save",
  subtitle = "",
  suggestions = [],
  suggestionsLabel,
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
        <ShowcaseNameField
          label={label}
          onChange={setValue}
          suggestions={suggestions}
          suggestionsLabel={suggestionsLabel}
          value={value}
        />

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
