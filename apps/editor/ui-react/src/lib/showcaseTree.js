// Pure helpers over a Showcase's nested node tree. The tree arrives from
// `GET /api/showcases/:id/tree` already nested and ordered, so these functions
// only walk, replace, remove, append, and derive state — they never read the
// network and hold no state. Keeping them here (beside `showcaseCovers.js`)
// lets the screen stay about rendering and lets the walkers be tested on plain
// objects. Catalog state (owned/seen/unseen, counts, filters, the primary, and
// the merge key) is derived from the flags the server supplies.

import {
  formatShowcaseCatalogNumber,
  showcaseNoteDisplayParts,
  showcaseNoteTitleParts,
} from "./showcaseNoteLabels.js";

// Walk the tree by the drilled node ids. A stale id (e.g. a node removed in
// another tab) stops the walk at the last resolvable level.
function findNodePath(nodes, ids) {
  const path = [];
  let level = nodes;

  for (const id of ids) {
    const node = level.find((entry) => entry.id === id);

    if (!node) {
      break;
    }

    path.push(node);
    level = node.children ?? [];
  }

  return path;
}

// The id chain from the root to `targetId`, or [] when it is not in this tree.
// View mode derives its drill state from the `?node=` parameter through this.
function findNodeIdPath(nodes, targetId) {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node.id];
    }

    const nested = findNodeIdPath(node.children ?? [], targetId);

    if (nested.length) {
      return [node.id, ...nested];
    }
  }

  return [];
}

// Every Category Placement or Grouping in preorder, each with the names that
// lead to it, so same-named Groupings at different levels stay distinct.
function containerNodes(nodes, trail = []) {
  const found = [];

  for (const node of nodes ?? []) {
    if (node.node_type !== "category" && node.node_type !== "grouping") {
      continue;
    }

    const path = [...trail, node.name ?? "Untitled"];
    found.push({ id: node.id, path });
    found.push(...containerNodes(node.children, path));
  }

  return found;
}

function findNodeById(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    const found = findNodeById(node.children ?? [], nodeId);

    if (found) {
      return found;
    }
  }

  return null;
}

// One label for a card of any kind, shared by drag announcements, the spring
// drawer, and the move dialog. Catalog entries and notes have no `name`.
function showcaseNodeLabel(node) {
  if (!node) {
    return "item";
  }

  if (node.node_type === "note") {
    return showcaseNoteDisplayParts(node.note ?? {}).join(" ") || "note";
  }

  if (isCatalogEntry(node)) {
    return catalogEntryIdentity(node.entry);
  }

  return node.name ?? "item";
}

function showcaseNodeTypeLabel(node) {
  if (!node) {
    return "Item";
  }

  if (node.node_type === "note") {
    return "Note";
  }

  if (isCatalogEntry(node)) {
    return "Placeholder";
  }

  return node.node_type === "grouping" ? "Grouping" : "Category";
}

// The parent id of a node, or null for a top-level node (and for an id that is
// not in this tree). Insert-after and remove focus both need it.
function findParentId(nodes, nodeId) {
  for (const node of nodes ?? []) {
    if ((node.children ?? []).some((child) => child.id === nodeId)) {
      return node.id;
    }

    const nested = findParentId(node.children, nodeId);

    if (nested != null) {
      return nested;
    }
  }

  return null;
}

// The card node that displays a Note. Ownership is per Note, so a mark repaints
// the tree at this node; `null` when the Note is not in this Showcase.
function findNodeIdForNote(nodes, noteId) {
  for (const node of nodes ?? []) {
    if (node.node_type === "note" && node.note?.id === noteId) {
      return node.id;
    }

    const nested = findNodeIdForNote(node.children, noteId);

    if (nested != null) {
      return nested;
    }
  }

  return null;
}

// Replace one node anywhere in the tree, keeping the same references when the
// id is not present so React does not re-render untouched branches.
function updateNodeTree(nodes, nodeId, update) {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === nodeId) {
      changed = true;
      return update(node);
    }

    if (node.children?.length) {
      const children = updateNodeTree(node.children, nodeId, update);

      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
    }

    return node;
  });

  return changed ? next : nodes;
}

function removeNodeTree(nodes, nodeId) {
  let changed = false;
  const next = [];

  for (const node of nodes) {
    if (node.id === nodeId) {
      changed = true;
      continue;
    }

    if (node.children?.length) {
      const children = removeNodeTree(node.children, nodeId);

      if (children !== node.children) {
        changed = true;
        next.push({ ...node, children });
        continue;
      }
    }

    next.push(node);
  }

  return changed ? next : nodes;
}

// Apply a batch of just-added children under their parent, anywhere in the tree,
// from the server's rows — no full refetch.
function appendChildren(nodes, parentId, added) {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: [...(node.children ?? []), ...added] };
    }

    if (node.children?.length) {
      return { ...node, children: appendChildren(node.children, parentId, added) };
    }

    return node;
  });
}

// Put a parent's children into the given id order, keeping any node the caller
// omitted at the end (defensive: the server rejects a partial list anyway).
function applyChildOrder(children, orderedIds) {
  const byId = new Map(children.map((node) => [node.id, node]));

  for (const nodeId of orderedIds) {
    byId.delete(nodeId);
  }

  const ordered = orderedIds
    .map((nodeId) => children.find((node) => node.id === nodeId))
    .filter(Boolean);

  return [...ordered, ...byId.values()];
}

// Apply a reorder to the local tree without refetching: the top level when the
// parent is null, otherwise the matching parent's children.
function reorderNodeTree(nodes, parentId, orderedIds) {
  if (parentId == null) {
    return applyChildOrder(nodes, orderedIds);
  }

  return updateNodeTree(nodes, parentId, (parent) => ({
    ...parent,
    children: applyChildOrder(parent.children ?? [], orderedIds),
  }));
}

// Insert one already-removed node under a parent at `index` (the final
// zero-based position). The top level is `parentId == null`.
function insertNodeTree(nodes, parentId, index, node) {  if (parentId == null) {
    const next = [...nodes];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return next;
  }

  return updateNodeTree(nodes, parentId, (parent) => {
    const children = [...(parent.children ?? [])];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
    return { ...parent, children };
  });
}

// Reparent one node without refetching: remove it from wherever it sits, then
// insert it under `parentId` at the final index. A target inside the moved
// subtree is refused on the server, so the helper returns the tree untouched
// rather than silently duplicating the node.
function moveNodeTree(nodes, nodeId, parentId, index) {
  const node = findNodeById(nodes, nodeId);

  if (!node) {
    return nodes;
  }

  if (parentId != null) {
    const targetPath = findNodeIdPath(nodes, parentId);

    if (targetPath.includes(nodeId)) {
      return nodes;
    }
  }

  return insertNodeTree(
    removeNodeTree(nodes, nodeId),
    parentId,
    index,
    node,
  );
}

// The final index for appending a node to a sibling list that may still hold
// it. The server's `position` counts the list after the source is removed, so
// both drag drops and the move dialog share this one calculation.
function appendPositionFor(children, nodeId) {
  return (children ?? []).filter((child) => child.id !== nodeId).length;
}

// The number of note nodes anywhere in the tree. The presentation header's
// "N notes" total reads this (falls back to the showcase row before load).
function countNoteNodes(nodes) {
  let total = 0;

  for (const node of nodes) {
    if (node.node_type === "note") {
      total += 1;
    }

    if (node.children?.length) {
      total += countNoteNodes(node.children);
    }
  }

  return total;
}

// View mode keeps a Grouping when anything presentable sits beneath it: a note
// leaf or a Catalog entry. An entry is always a planned position, so hiding the
// Grouping would hide the checklist's empty slots too.
function isPresentable(node) {
  return (
    node.node_type === "note" ||
    isCatalogEntry(node) ||
    (node.children ?? []).some(isPresentable)
  );
}

// View mode hides empty Groupings (nothing presentable beneath them) so the
// presentation never shows an empty card; edit mode keeps them so they can be
// filled. Notes and Categories pass through untouched — Categories are filtered
// at the section level, not here.
function visibleChildNodes(children, editMode) {
  if (editMode) {
    return children;
  }

  return (children ?? []).filter(
    (node) => node.node_type !== "grouping" || isPresentable(node),
  );
}

// ── Catalog state ─────────────────────────────────────────────────────────

function isCatalogEntry(node) {
  return node?.node_type === "catalog_entry";
}

function isNoteNode(node) {
  return node?.node_type === "note";
}

// A Placeholder is one planned position: it holds no note, so it is always
// unseen until the collector replaces it with a real note card.
function catalogEntryState() {
  return "unseen";
}

// A note leaf has no unseen state: it is the library record, so its own flag
// is the whole answer.
function showcaseNoteState(node) {
  return node?.note?.owned ? "owned" : "seen";
}

// The card state for a node, or null for containers (categories, groupings).
function nodeCatalogState(node) {
  if (isCatalogEntry(node)) {
    return catalogEntryState();
  }

  if (node?.node_type === "note") {
    return showcaseNoteState(node);
  }

  return null;
}

// Presentation order for a catalog: one slide per owned note leaf, in tree
// order. Seen and unseen cards are skipped, and a planned position never
// presents because it holds no note.
function catalogPresentationNotes(nodes) {
  const out = [];

  function walk(list) {
    for (const node of list ?? []) {
      const state = nodeCatalogState(node);

      if (state) {
        if (state === "owned" && node.note) {
          out.push({ nodeId: node.id, note: node.note });
        }

        continue;
      }

      walk(node.children);
    }
  }

  walk(nodes);
  return out;
}

// Header and filter counts over every card in the tree: Catalog entries and
// note leaves. `complete` means nothing is missing (no seen and no unseen).
// The sidebar row is entry-based instead (see `showcaseCountLabel`).
function catalogCounts(nodes) {
  const counts = { owned: 0, seen: 0, unseen: 0, total: 0, complete: false };

  function visit(list) {
    for (const node of list ?? []) {
      const state = nodeCatalogState(node);

      if (state) {
        counts[state] += 1;
        counts.total += 1;
      }

      visit(node.children);
    }
  }

  visit(nodes);
  counts.complete =
    counts.total > 0 && counts.seen === 0 && counts.unseen === 0;

  return counts;
}

// Apply one of the catalog filters without losing the containers that hold a
// match. Entries and note leaves match by state; a Grouping survives only when
// a match sits beneath it, and an empty Category drops out so no section
// renders bare. `all` hands the tree back untouched.
function filterCatalogTree(nodes, filter) {
  if (!filter || filter === "all") {
    return nodes;
  }

  const keep = (list) => {
    const result = [];

    for (const node of list ?? []) {
      const state = nodeCatalogState(node);

      if (state) {
        if (state === filter) {
          result.push(node);
        }

        continue;
      }

      const children = keep(node.children);

      if (children.length) {
        result.push({ ...node, children });
      }
    }

    return result;
  };

  return keep(nodes);
}

// The entry's shortest identity, for the empty well and a manager's heading:
// the catalog value, else the denomination, else "Unidentified".
function catalogEntryIdentity(entry) {
  return (
    formatShowcaseCatalogNumber(entry?.catalog_number) ||
    String(entry?.denomination ?? "").trim() ||
    "Unidentified"
  );
}

// The entry's one-line caption for cards, previews, and the editor: catalog
// value · date · denomination, falling back to the identity when the entry
// carries no details.
// `compact` is the small card's `P17` form of the catalog value.
function catalogEntryCaption(entry, options = {}) {
  return (
    showcaseNoteTitleParts(entry, options).join(" · ") ||
    catalogEntryIdentity(entry)
  );
}

// The entry's identity for accessible names and managers: its own catalog
// metadata, because the position and the record are independent. Falls back to
// the denomination, then to "Unidentified".
function catalogEntryLabel(entry) {
  const catalog = formatShowcaseCatalogNumber(entry?.catalog_number);
  const denomination = String(entry?.denomination ?? "").trim();
  const issueDate = String(entry?.issue_date ?? "").trim();
  const identity = catalogEntryIdentity(entry);
  const details = [catalog ? denomination : "", issueDate].filter(Boolean);

  return [identity, ...details].join(", ");
}

// One entry's catalog metadata as the wire shape carries it: four trimmed
// strings. A Note or a partial entry both feed it.
function normalizeCatalogEntry(entry) {
  const text = (value) => String(value ?? "").trim();

  return {
    catalog_number: text(entry?.catalog_number),
    denomination: text(entry?.denomination),
    issue_date: text(entry?.issue_date),
    source: text(entry?.source),
  };
}

// Metadata equality ignores surrounding whitespace, the only difference the
// form can introduce without meaning a change.
function sameCatalogEntry(left, right) {
  const a = normalizeCatalogEntry(left);
  const b = normalizeCatalogEntry(right);

  return Object.keys(a).every((field) => a[field] === b[field]);
}

// Mark one Note owned or not owned everywhere the tree shows it: its note
// leaves. The flag is the library record's, so one change repaints every card
// in every Showcase that displays the same note.
// Returns the same tree when the note is absent or already carries the flag.
function setNoteOwned(nodes, noteId, owned) {
  const list = nodes ?? [];
  let changed = false;

  const next = list.map((node) => {
    let updated = node;

    if (
      node.node_type === "note" &&
      node.note?.id === noteId &&
      node.note.owned !== owned
    ) {
      updated = { ...node, note: { ...node.note, owned } };
    }

    if (node.children?.length) {
      const children = setNoteOwned(node.children, noteId, owned);

      if (children !== node.children) {
        updated = { ...updated, children };
      }
    }

    if (updated !== node) {
      changed = true;
    }

    return updated;
  });

  return changed ? next : list;
}

// The Note's owned flag as the tree currently holds it. An ownership write
// reads this, not the render-time Note, so a second write (Undo) reverts from
// the live value rather than from the value before the first write.
function noteOwnedInTree(nodes, noteId) {
  const nodeId = findNodeIdForNote(nodes, noteId);

  if (nodeId == null) {
    return undefined;
  }

  const node = findNodeById(nodes, nodeId);

  if (!node) {
    return undefined;
  }

  return node.note?.owned;
}

// The showcase list row's sidebar count. A catalog showcase prints owned over
// total entries; a presentation-only showcase keeps its note count. `null`
// lets the sidebar fall back to initials when the payload has no count yet.
function showcaseCountLabel(showcase) {
  if (!showcase) {
    return null;
  }

  if ((showcase.catalog_entry_count ?? 0) > 0) {
    const owned = Number.isFinite(showcase.owned_count)
      ? showcase.owned_count
      : 0;
    const total = Number.isFinite(showcase.entry_count)
      ? showcase.entry_count
      : 0;

    return `${owned} / ${total}`;
  }

  return Number.isFinite(showcase.note_count)
    ? String(showcase.note_count)
    : null;
}

export {
  appendChildren,
  appendPositionFor,
  applyChildOrder,
  catalogCounts,
  catalogEntryCaption,
  catalogEntryIdentity,
  catalogEntryLabel,
  catalogEntryState,
  catalogPresentationNotes,
  containerNodes,
  countNoteNodes,
  filterCatalogTree,
  findNodeById,
  findNodeIdForNote,
  findNodeIdPath,
  findNodePath,
  findParentId,
  isCatalogEntry,
  isNoteNode,
  moveNodeTree,
  nodeCatalogState,
  normalizeCatalogEntry,
  noteOwnedInTree,
  removeNodeTree,
  reorderNodeTree,
  sameCatalogEntry,
  setNoteOwned,
  showcaseCountLabel,
  showcaseNodeLabel,
  showcaseNodeTypeLabel,
  showcaseNoteState,
  updateNodeTree,
  visibleChildNodes,
};
