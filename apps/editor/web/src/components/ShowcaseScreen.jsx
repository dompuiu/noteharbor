import { useEffect, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useShowcases } from "../lib/showcases.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell so the two never drift. The tree, cards, and grid land here in
// later tickets; for now both modes show the empty-showcase message.
function ShowcaseScreen({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const { showcases } = useShowcases();
  const showcaseId = Number(id);
  const showcase = showcases.find((entry) => entry.id === showcaseId) ?? null;
  const showcaseName = showcase?.name ?? "Showcase";
  // Arriving from `+ New showcase` opens the name field focused (and selected)
  // so the user can name the showcase immediately.
  const justCreated = mode === "edit" && Boolean(location.state?.justCreated);
  const nameFieldRef = useRef(null);

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
                defaultValue={showcaseName}
                ref={nameFieldRef}
              />
            ) : (
              <h1>{showcaseName}</h1>
            )}
          </div>
        </div>

        <p className="muted showcase-empty">This showcase is empty.</p>
      </div>
    </section>
  );
}

export { ShowcaseScreen };
