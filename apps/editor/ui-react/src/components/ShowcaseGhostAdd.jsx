import { useId } from "react";

const VARIANT_CLASS = {
  bar: "showcase-ghost-add--bar",
  centered: "showcase-ghost-add--centered",
};

// One flat add affordance shared by every showcase level. The bar variant
// closes a grid; the centered variant sits inside the empty-state box. Keeping
// the markup here means the label, hint, and plus never drift between the two
// entry points.
function ShowcaseGhostAdd({
  ariaLabel,
  hint = null,
  label,
  onClick,
  variant = "bar",
}) {
  const hintId = useId();
  const className = ["showcase-ghost-add", VARIANT_CLASS[variant]]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-describedby={hint ? hintId : undefined}
      aria-label={ariaLabel}
      className={className}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="showcase-ghost-add-plus">
        +
      </span>
      <span className="showcase-ghost-add-copy">
        <span className="showcase-ghost-add-label">{label}</span>
        {hint ? (
          <span className="showcase-ghost-add-sub" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export { ShowcaseGhostAdd };
