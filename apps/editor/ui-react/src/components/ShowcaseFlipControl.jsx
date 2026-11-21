// The flip control shared by the Note card and the Catalog card: a small
// round control in the photo's bottom-right corner that turns the specimen
// over. It is its own keyboard stop — Enter or Space toggles the face and
// never reaches the card's activation — because the chord alone left the back
// unreachable without a pointer. The card owns the state; this control only
// reports a request, with `viaPointer` so the card can decide where focus
// lands.
function ShowcaseFlipControl({ onToggle, swapped }) {
  function handleKeyDown(event) {
    if (event.key === "Tab") {
      const cell = event.currentTarget.closest(".showcase-catalog-cell");

      if (event.shiftKey) {
        const menu = cell?.querySelector(".showcase-item-menu-trigger");

        if (menu) {
          event.preventDefault();
          menu.focus();
        }

        return;
      }

      // Forward Tab leaves the photo for the sibling chip, or the ownership
      // toggle when the card has no chip.
      const next =
        cell?.querySelector('[data-showcase-focus="siblings"]') ??
        cell?.querySelector(
          '[data-showcase-focus="ownership"], [data-showcase-focus="check"]',
        );

      if (next) {
        event.preventDefault();
        next.focus();
      }

      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onToggle?.(false);
  }

  return (
    <span
      aria-label={swapped ? "Show front" : "Show back"}
      className="showcase-card-flip"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.(true);
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={swapped ? "Show front" : "Show back"}
    >
      <svg
        aria-hidden="true"
        className="showcase-card-flip-icon"
        focusable="false"
        height="14"
        viewBox="0 0 24 24"
        width="14"
      >
        <path
          d="M7 8h10l-3-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M17 16H7l3 3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

export { ShowcaseFlipControl };
