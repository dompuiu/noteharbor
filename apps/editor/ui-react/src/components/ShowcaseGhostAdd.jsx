import { useId } from "react";

const VARIANT_CLASS = {
  card: "showcase-add-card",
  bar: "showcase-ghost-add--bar",
  centered: "showcase-ghost-add--centered",
};

// One flat add affordance shared by every showcase level. The card variant
// fills a grid cell; the bar and centered variants are the root and
// empty-state category actions. Keeping the markup here means the label,
// hint, and plus never drift between the two entry points.
function ShowcaseGhostAdd({
  ariaLabel,
  hint = null,
  label,
  onClick,
  variant = "card",
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
