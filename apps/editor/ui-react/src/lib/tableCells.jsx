// Alignment travels with the column model (`align`: text left, display order
// right, selection/thumbnail/actions centered) and is emitted as a class on
// every header and body cell. The stylesheet owns the actual text-align, so
// hidden and reordered columns cannot drift out of alignment.
export function alignmentClass(column) {
  return `align-${column?.align ?? "left"}`;
}

// Header and body cells build their classes from the same column model, so a
// compact column keeps one content box and one alignment in both places.
export function cellClass(column) {
  return [
    alignmentClass(column),
    column.key ? `table-col-${column.key}` : null,
    column.kind === "reorder" ? "drag-cell" : null,
    column.kind === "order" ? "table-order-cell" : null,
    column.kind === "thumbnail" ? "table-thumb-cell" : null,
    column.kind === "actions" ? "table-actions-cell" : null,
    column.isTags ? "tags-column" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Marks the terms a row matched, so a result set explains itself instead of
// leaving the collector to guess which field matched. The row model memoizes
// the marks and compiled terms, so this runs when a filter changes rather
// than on every parent commit.
export function highlightTerms(text, terms) {
  const raw = String(text ?? "");
  const needles = [
    ...new Set((terms ?? []).filter(Boolean).map((term) => String(term))),
  ].sort((left, right) => right.length - left.length);

  if (!needles.length) {
    return raw;
  }

  const pattern = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");
  const parts = raw.split(pattern);

  if (parts.length === 1) {
    return raw;
  }

  return parts.map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part,
  );
}

export function versionedImagePath(path, version) {
  if (!path) {
    return null;
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

export function pickImage(note, type, variant = "full") {
  const imagePath =
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(imagePath, note.updated_at);
}

// The first image that exists in the order the table prefers: front thumbnail,
// then front full, then back thumbnail, then back full.
export function pickFirstAvailableImage(note, slots) {
  for (const [type, variant] of slots) {
    const imagePath = pickImage(note, type, variant);

    if (imagePath) {
      return { path: imagePath, type, variant };
    }
  }

  return null;
}

export const tableThumbnailSlots = [
  ["front", "thumbnail"],
  ["front", "full"],
  ["back", "thumbnail"],
  ["back", "full"],
];
