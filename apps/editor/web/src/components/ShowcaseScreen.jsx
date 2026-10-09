import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { useShowcases } from "../lib/showcases.jsx";
import { DEFAULT_DESTINATION, PORTFOLIO_ROUTES } from "../lib/routes.js";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell so the two never drift. The tree, cards, and grid land here in
// later tickets; for now both modes show the empty-showcase message.
function ShowcaseScreen({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showcases, deleteShowcase, renameShowcase } = useShowcases();
  const showcaseId = Number(id);
  const showcase = showcases.find((entry) => entry.id === showcaseId) ?? null;
  const showcaseName = showcase?.name ?? "Showcase";
  // Arriving from `+ New showcase` opens the name field focused (and selected)
  // so the user can name the showcase immediately.
  const justCreated = mode === "edit" && Boolean(location.state?.justCreated);
  const nameFieldRef = useRef(null);
  const [nameDraft, setNameDraft] = useState(showcaseName);
  const [nameError, setNameError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog } = useConfirmation();

  useEffect(() => {
    if (!justCreated) {
      return;
    }

    const field = nameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [justCreated]);

  // The heading and the sidebar both read the provider's row, so a rename is
  // reflected everywhere from one applied server row. Keep the local draft in
  // step with it (a list load can arrive after the first render, and a saved
  // rename normalises whitespace), but never clobber text the user is typing.
  useEffect(() => {
    if (document.activeElement === nameFieldRef.current) {
      return;
    }

    setNameDraft(showcaseName);
  }, [showcaseName]);

  async function commitName() {
    if (!showcase) {
      return;
    }

    const trimmed = nameDraft.trim();

    if (!trimmed) {
      setNameDraft(showcase.name);
      setNameError("A showcase name is required.");
      return;
    }

    if (trimmed === showcase.name) {
      setNameDraft(showcase.name);
      setNameError("");
      return;
    }

    try {
      await renameShowcase(showcase.id, trimmed);
      setNameError("");
    } catch (error) {
      setNameError(error.message);
      setNameDraft(showcase.name);
    }
  }

  function handleNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setNameDraft(showcaseName);
      setNameError("");
    }
  }

  async function handleDelete() {
    if (!showcase || deleting) {
      return;
    }

    const confirmed = await confirm({
      body: "This removes the showcase and everything in it. The notes stay in their collections.",
      confirmLabel: "Delete",
      title: `Delete "${showcase.name}"?`,
    });

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const { nextShowcaseId } = await deleteShowcase(showcase.id);

      if (nextShowcaseId != null) {
        navigate(PORTFOLIO_ROUTES.showcaseEdit(nextShowcaseId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  return (
    <section className="screen-stack narrow-stack showcase-screen">
      <div className="panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            <p className="eyebrow">Showcases</p>
            {mode === "edit" ? (
              <input
                aria-label="Showcase name"
                className="showcase-name-field"
                onBlur={commitName}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={handleNameKeyDown}
                ref={nameFieldRef}
                value={nameDraft}
              />
            ) : (
              <h1>{showcaseName}</h1>
            )}
          </div>
          {mode === "edit" && showcase ? (
            <div className="panel-heading-actions">
              <button
                className="button button-danger"
                disabled={deleting}
                onClick={handleDelete}
                type="button"
              >
                Delete showcase
              </button>
            </div>
          ) : null}
        </div>

        {nameError ? (
          <p className="muted showcase-name-error" role="alert">
            {nameError}
          </p>
        ) : null}

        <p className="muted showcase-empty">This showcase is empty.</p>
      </div>

      {dialog}
    </section>
  );
}

export { ShowcaseScreen };
