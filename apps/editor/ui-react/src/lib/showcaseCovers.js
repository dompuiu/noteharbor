// The shared Grouping cover resolver. A Grouping card shows the manual cover
// Note when one is set; otherwise the first Note beneath it, depth-first in
// manual (position) order. With nothing resolvable it returns null, and the
// card falls back to a neutral gradient placeholder (presentation spec §4).
//
// The tree already carries the referenced Note (`cover_note`, `note`) so the
// resolver is a pure function over one node and stays independent of the
// Notes table / slideshow image logic.
function firstNoteBeneath(node) {
  for (const child of node?.children ?? []) {
    if (child.node_type === "note" && child.note) {
      return child.note;
    }

    const nested = firstNoteBeneath(child);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function resolveGroupingCover(node) {
  if (node?.cover_note) {
    return node.cover_note;
  }

  return firstNoteBeneath(node);
}

export { resolveGroupingCover };
