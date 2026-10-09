import { firstAvailableNoteImage, pickNoteImage } from "../lib/showcaseImages.js";

// The shared read-only Note card (presentation spec §3). It is presentation
// only: the view-mode hover/focus/tap swap is wired by the caller passing
// `pressed` (ticket 12), and edit mode never swaps. The card picks the front
// image, falling back to the back, then a muted "No image", through the
// showcase-local image helper — never the slideshow's or the table's.
function pickBackImage(note) {
  return (
    pickNoteImage(note, "back", "thumbnail") ||
    pickNoteImage(note, "back", "full")
  );
}

function ShowcaseNoteCard({ note, mode = "view", pressed = false, onOpen }) {
  const editMode = mode === "edit";
  const primary = firstAvailableNoteImage(note);
  const back = pickBackImage(note);
  // The swap needs a distinct back; a back-only note shows the back as its sole
  // image and never swaps (presentation spec §9).
  const hasDistinctBack = primary?.type === "front" && Boolean(back);
  const swapped = !editMode && pressed && hasDistinctBack;
  const path = swapped ? back : (primary?.path ?? "");
  const side = swapped ? "back" : (primary?.type ?? null);
  const denomination = String(note?.denomination ?? "").trim();
  const issueDate = String(note?.issue_date ?? "").trim();
  const caption = [denomination, issueDate].filter(Boolean).join(" · ");
  const label = [denomination, issueDate].filter(Boolean).join(", ");

  return (
    <button
      aria-label={label}
      aria-pressed={swapped}
      className={`showcase-card showcase-card--note${swapped ? " showcase-card--back" : ""}`}
      onClick={onOpen}
      type="button"
    >
      <span className="showcase-card-image">
        {path ? (
          <img
            alt={side === "back" ? `${label} (back)` : label}
            src={path}
          />
        ) : (
          <span className="showcase-card-no-image">No image</span>
        )}
      </span>
      <span className="showcase-card-caption">{caption}</span>
    </button>
  );
}

export { ShowcaseNoteCard };
