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

// A pinned column keeps its identity block in place while the columns scrolled
// under it carry the shadow that marks the end of that block. The row model
// needs the class alone, a header needs the class and the offset together, and
// both read the same pinning data, so the composition lives in one place.
export function stickyCellClass(column, baseClassName, lastStickyColumnKey) {
  if (!column.sticky) {
    return baseClassName;
  }

  return [
    baseClassName,
    "table-sticky-cell",
    column.key === lastStickyColumnKey ? "table-sticky-end" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function stickyCellStyle(column, stickyLeftByColumn) {
  if (!column.sticky) {
    return undefined;
  }

  return {
    "--table-sticky-left": `${stickyLeftByColumn[column.key] ?? 0}px`,
  };
}

export function stickyCellAttributes(
  column,
  baseClassName,
  { lastStickyColumnKey, stickyLeftByColumn },
) {
  const className = stickyCellClass(column, baseClassName, lastStickyColumnKey);

  if (!column.sticky) {
    return baseClassName ? { className } : {};
  }

  return {
    className,
    style: stickyCellStyle(column, stickyLeftByColumn),
  };
}

const highlightPatternCacheLimit = 200;
// A filter query is one set of terms, and every visible row marks it in every
// cell that matched. Compiling the expression per cell is the expensive part,
// so compiled patterns are kept here, bounded, and shared by every cell of
// the same query. Insertion order is the eviction order: a cleared cache only
// costs a recompile on the next row.
const highlightPatternCache = new Map();

// The matcher for a query, or null when there is nothing to mark — the empty
// case returns before any allocation so an unfiltered table pays nothing.
export function compileHighlightTerms(terms) {
  const needles = [
    ...new Set((terms ?? []).filter(Boolean).map((term) => String(term))),
  ].sort((left, right) => right.length - left.length);

  if (!needles.length) {
    return null;
  }

  const cacheKey = needles.join("\u0000");
  const cached = highlightPatternCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pattern = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");

  if (highlightPatternCache.size >= highlightPatternCacheLimit) {
    highlightPatternCache.clear();
  }

  highlightPatternCache.set(cacheKey, pattern);
  return pattern;
}

// Marks the terms a row matched, so a result set explains itself instead of
// leaving the collector to guess which field matched. The row model memoizes
// the marks and the compiled matcher, so this runs when a filter changes rather
// than on every parent commit.
export function highlightTerms(text, terms) {
  const raw = String(text ?? "");
  const pattern = compileHighlightTerms(terms);

  if (!pattern) {
    return raw;
  }

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

// The one derivation of a note's table picture. The row model carries it for
// every note in the painted list; the screens that can talk about a note
// outside that list (a delete confirmation opened from the slideshow) ask for
// it directly instead of keeping a second copy of the preference order.
export function noteThumbnailPath(note) {
  return pickFirstAvailableImage(note, tableThumbnailSlots)?.path ?? null;
}
