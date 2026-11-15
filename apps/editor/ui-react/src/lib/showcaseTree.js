// Pure helpers over a Showcase's nested node tree. The tree arrives from
// `GET /api/showcases/:id/tree` already nested and ordered, so these functions
// only walk, replace, remove, append, and derive state — they never read the
// network and hold no state. Keeping them here (beside `showcaseCovers.js`)
// lets the screen stay about rendering and lets the walkers be tested on plain
// objects. Catalog state (owned/seen/unseen, counts, filters, the primary, and
// the merge key) is derived from the flags the server supplies.

import {
  formatShowcaseCatalogNumber,
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

// The card node that displays a Note, whether it is a note leaf or a Catalog
// entry's specimen. Ownership is per Note, so a mark repaints the tree at this
// node; `null` when the Note is not in this Showcase.
function findNodeIdForNote(nodes, noteId) {
  for (const node of nodes ?? []) {
    if (node.node_type === "note" && node.note?.id === noteId) {
      return node.id;
    }

    if ((node.specimens ?? []).some((specimen) => specimen?.id === noteId)) {
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
// leaf or a Catalog entry. An entry is a position even with no specimens, so
// hiding the Grouping would hide the checklist's empty slots too.
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
//
// The server supplies specimens and the owned flags; every state below is
// derived here. The primary specimen is display-only: it never changes the
// entry's ownership.

function isCatalogEntry(node) {
  return node?.node_type === "catalog_entry";
}

// An entry with no specimens is a planned position (unseen); any owned
// specimen makes the entry owned, even when the primary is an unowned
// reference scan.
function catalogEntryState(node) {
  const specimens = node?.specimens ?? [];

  if (specimens.length === 0) {
    return "unseen";
  }

  return specimens.some((specimen) => specimen?.owned) ? "owned" : "seen";
}

// A note leaf has no unseen state: it is the library record, so its own flag
// is the whole answer.
function showcaseNoteState(node) {
  return node?.note?.owned ? "owned" : "seen";
}

// The card state for a node, or null for containers (categories, groupings).
function nodeCatalogState(node) {
  if (isCatalogEntry(node)) {
    return catalogEntryState(node);
  }

  if (node?.node_type === "note") {
    return showcaseNoteState(node);
  }

  return null;
}

function hasCatalogEntries(nodes) {
  return (nodes ?? []).some(
    (node) => isCatalogEntry(node) || hasCatalogEntries(node.children),
  );
}

// The Note a card or a slide shows. The server keeps one primary per entry; a
// stale or missing id falls back to the first specimen so a position with
// specimens never loses its picture.
function primarySpecimen(node) {
  const specimens = node?.specimens ?? [];
  const primary = specimens.find(
    (specimen) => specimen?.id === node?.primary_note_id,
  );

  return primary ?? specimens[0] ?? null;
}

// An owned entry may present an unowned reference scan: the check stays and
// the quiet strip says "seen primary".
function hasSeenPrimary(node) {
  const primary = primarySpecimen(node);

  return (
    catalogEntryState(node) === "owned" &&
    primary != null &&
    !primary.owned
  );
}

// Presentation order for a catalog: one slide per owned card, in tree order,
// using an entry's primary or a note leaf's own Note. Seen and unseen cards are
// skipped. A presentation-only Showcase keeps using the existing preview walk.
function catalogPresentationNotes(nodes) {
  const out = [];

  function walk(list) {
    for (const node of list ?? []) {
      const state = nodeCatalogState(node);

      if (state) {
        const note = isCatalogEntry(node) ? primarySpecimen(node) : node.note;

        if (state === "owned" && note) {
          out.push({ nodeId: node.id, note });
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

// How many cards one Category (or Grouping) holds. In a catalog an entry is a
// card even with no specimens; in a presentation only note leaves count. Both
// the root's empty-section rule and a section's own guard read this.
function categoryCardCount(node, catalogMode) {
  return catalogMode
    ? catalogCounts([node]).total
    : countNoteNodes([node]);
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

// The entry's shortest identity, for the empty specimen well and a manager's
// heading: the catalog value, else the denomination, else "Unidentified".
function catalogEntryIdentity(entry) {
  return (
    formatShowcaseCatalogNumber(entry?.catalog_number) ||
    String(entry?.denomination ?? "").trim() ||
    "Unidentified"
  );
}

// The entry's one-line caption for cards, previews, and the editor: catalog
// value · date · denomination, falling back to the identity when the entry
// carries no details. The position's own metadata, never the specimen.
// `compact` is the small card's `P17` form of the catalog value.
function catalogEntryCaption(entry, options = {}) {
  return (
    showcaseNoteTitleParts(entry, options).join(" · ") ||
    catalogEntryIdentity(entry)
  );
}

// The quiet specimen line a multi-note entry carries: how many notes and
// whether the primary is a seen reference on an owned entry.
function specimenSummary(node) {
  const count = specimenNoteIds(node).length;

  return `${count} ${count === 1 ? "note" : "notes"} · ${
    hasSeenPrimary(node) ? "seen primary" : "primary"
  }`;
}

// The entry's identity for accessible names and managers: its own catalog
// metadata, never the primary Note, because the position and the record are
// independent. Falls back to the denomination, then to "Unidentified".
function catalogEntryLabel(entry) {
  const catalog = formatShowcaseCatalogNumber(entry?.catalog_number);
  const denomination = String(entry?.denomination ?? "").trim();
  const issueDate = String(entry?.issue_date ?? "").trim();
  const identity = catalogEntryIdentity(entry);
  const details = [catalog ? denomination : "", issueDate].filter(Boolean);

  return [identity, ...details].join(", ");
}

// The catalog value two entries must share to merge. Trimming, case, and the
// Pick / bare-P prefix are formatting: `22a` and `22b` stay distinct positions.
function catalogMergeKey(value) {
  return formatShowcaseCatalogNumber(value)
    .replace(/^pick\s*/i, "")
    .toLowerCase();
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

function specimenNoteIds(node) {
  return (node?.specimens ?? [])
    .map((specimen) => Number(specimen?.id))
    .filter((id) => Number.isInteger(id));
}

// The full-set payload for `PUT /api/nodes/:id/notes`: ordered ids plus the
// primary, falling back to the first specimen when the stored primary is stale
// or absent. The same object serves draft replay, view-mode saves, and Undo.
function specimenPayload(node) {
  const noteIds = specimenNoteIds(node);
  const storedPrimary = node?.primary_note_id;
  const primaryNoteId = noteIds.includes(storedPrimary)
    ? storedPrimary
    : (noteIds[0] ?? null);
  const payload = { note_ids: noteIds };

  if (primaryNoteId != null) {
    payload.primary_note_id = primaryNoteId;
  }

  return payload;
}

// Plan the next specimen set for an add. Notes already on the entry are
// ignored; `notes` supplies the records the new ids attach. A null plan means
// nothing would be added.
function planSpecimenAdd(entry, noteIds, notes = []) {
  const existingIds = specimenNoteIds(entry);
  const addedIds = [...new Set(noteIds ?? [])].filter(
    (noteId) =>
      Number.isInteger(noteId) && !existingIds.includes(noteId),
  );

  if (!addedIds.length) {
    return null;
  }

  const byId = new Map((notes ?? []).map((note) => [note.id, note]));
  const specimens = [
    ...(entry?.specimens ?? []),
    ...addedIds.map((noteId) => byId.get(noteId) ?? { id: noteId }),
  ];

  return {
    addedIds,
    specimens,
    payload: specimenPayload({ ...entry, specimens }),
  };
}

// Plan a primary change. A missing specimen or the current primary is a no-op.
function planSpecimenPromote(entry, noteId) {
  const specimens = entry?.specimens ?? [];

  if (
    !specimens.some((specimen) => specimen?.id === noteId) ||
    entry?.primary_note_id === noteId
  ) {
    return null;
  }

  return {
    specimens,
    payload: specimenPayload({ ...entry, primary_note_id: noteId }),
  };
}

// Plan a removal, promoting the first remaining specimen when the primary is
// the one leaving. The server applies the same rule; this keeps the draft
// about to be saved identical to what it would return.
function planSpecimenRemove(entry, noteId) {
  const specimens = entry?.specimens ?? [];
  const removed = specimens.find((specimen) => specimen?.id === noteId);

  if (!removed) {
    return null;
  }

  const remaining = specimens.filter((specimen) => specimen?.id !== noteId);

  return {
    removed,
    specimens: remaining,
    payload: specimenPayload({
      ...entry,
      specimens: remaining,
      primary_note_id:
        entry?.primary_note_id === noteId ? null : entry?.primary_note_id,
    }),
  };
}

// Mark one Note owned or not owned everywhere the tree shows it: its note
// leaves and its Catalog specimens. The flag is the library record's, so one
// change repaints every card in every Showcase that displays the same note.
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

    if (
      Array.isArray(node.specimens) &&
      node.specimens.some(
        (specimen) => specimen?.id === noteId && specimen.owned !== owned,
      )
    ) {
      updated = {
        ...updated,
        specimens: updated.specimens.map((specimen) =>
          specimen?.id === noteId ? { ...specimen, owned } : specimen,
        ),
      };
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

  if (node.node_type === "note") {
    return node.note?.owned;
  }

  return (node.specimens ?? []).find((specimen) => specimen?.id === noteId)
    ?.owned;
}

function entryFromNote(note) {
  return { ...normalizeCatalogEntry(note), source: "" };
}

// Plan the Add-notes → Catalog entries merge inside one parent's children.
// Notes group by exact catalog value: a group that matches an existing entry
// appends to that entry's full specimen set (the payload the full-set call
// takes), otherwise it becomes a new entry with a fresh metadata object. Notes
// without a catalog number and notes already on the matching entry are
// reported as skipped with the reason the inline message needs. A negative
// `nodeId` means the entry is still a draft and must be merged locally.
function planCatalogMerge(children, notes) {
  const groups = new Map();
  const skipped = [];

  for (const note of notes ?? []) {
    const key = catalogMergeKey(note?.catalog_number);

    if (!key) {
      skipped.push({ note, reason: "no-catalog-number" });
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    const group = groups.get(key);

    if (!group.some((entry) => entry?.id === note?.id)) {
      group.push(note);
    }
  }

  const merges = [];
  const additions = [];

  for (const [key, grouped] of groups.entries()) {
    const entry = (children ?? []).find(
      (child) =>
        isCatalogEntry(child) &&
        catalogMergeKey(child.entry?.catalog_number) === key,
    );

    if (!entry) {
      additions.push({
        entry: entryFromNote(grouped[0]),
        noteIds: grouped.map((note) => note.id),
      });
      continue;
    }

    const existingIds = specimenNoteIds(entry);
    const addedIds = grouped
      .map((note) => note?.id)
      .filter((id) => Number.isInteger(id) && !existingIds.includes(id));

    for (const note of grouped) {
      if (!addedIds.includes(note?.id)) {
        skipped.push({ note, reason: "already-on-entry" });
      }
    }

    if (!addedIds.length) {
      continue;
    }

    const noteIds = [...existingIds, ...addedIds];
    const primaryNoteId = noteIds.includes(entry.primary_note_id)
      ? entry.primary_note_id
      : noteIds[0];

    merges.push({
      nodeId: entry.id,
      noteIds,
      primaryNoteId,
      addedNoteIds: addedIds,
    });
  }

  return { merges, additions, skipped };
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
  applyChildOrder,
  catalogCounts,
  catalogEntryCaption,
  catalogEntryIdentity,
  catalogEntryLabel,
  catalogEntryState,
  catalogMergeKey,
  catalogPresentationNotes,
  categoryCardCount,
  countNoteNodes,
  filterCatalogTree,
  findNodeById,
  findNodeIdForNote,
  findNodeIdPath,
  findNodePath,
  findParentId,
  hasCatalogEntries,
  hasSeenPrimary,
  isCatalogEntry,
  nodeCatalogState,
  normalizeCatalogEntry,
  noteOwnedInTree,
  planCatalogMerge,
  planSpecimenAdd,
  planSpecimenPromote,
  planSpecimenRemove,
  primarySpecimen,
  removeNodeTree,
  reorderNodeTree,
  sameCatalogEntry,
  setNoteOwned,
  showcaseCountLabel,
  showcaseNoteState,
  specimenNoteIds,
  specimenPayload,
  specimenSummary,
  updateNodeTree,
  visibleChildNodes,
};
