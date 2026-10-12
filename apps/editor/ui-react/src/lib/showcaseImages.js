// Showcase-local note image selection. This is intentionally separate from the
// Note slideshow and the Notes table: the presentation spec forbids coupling the
// showcase cards to their duplicated image logic (presentation spec §10). It
// picks the front image, falling back to the back, at the thumbnail size with a
// full-size fallback, and cache-busts with the note's `updated_at`.
const IMAGE_SLOTS = [
  ["front", "thumbnail"],
  ["front", "full"],
  ["back", "thumbnail"],
  ["back", "full"],
];

function versionedImagePath(path, version) {
  if (!path) {
    return "";
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

function pickNoteImage(note, type, variant = "full") {
  const localPath =
    note?.images?.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(localPath, note?.updated_at);
}

// The first resolvable image, in the presentation order: front (thumbnail, then
// full), then back (thumbnail, then full). Returns `{ path, type, variant }` so
// the card knows which side it is showing, or null when the note has none.
function firstAvailableNoteImage(note) {
  for (const [type, variant] of IMAGE_SLOTS) {
    const path = pickNoteImage(note, type, variant);

    if (path) {
      return { path, type, variant };
    }
  }

  return null;
}

export { firstAvailableNoteImage, pickNoteImage, versionedImagePath };
