// Draft helpers for Showcase edit mode. Edit mode keeps a local draft tree with
// temporary (negative) ids; nothing touches the network until Save replays the
// diff. Baseline is the last server tree, draft is what the canvas shows.

import {
  isCatalogEntry,
  normalizeCatalogEntry,
  sameCatalogEntry,
  specimenPayload,
} from "./showcaseTree.js";

let nextTempId = -1;

function resetTempIds() {
  nextTempId = -1;
}

function takeTempId() {
  const id = nextTempId;
  nextTempId -= 1;
  return id;
}

function isTempId(id) {
  return Number.isInteger(id) && id < 0;
}

function walkNodes(nodes, visit, parentId = null) {
  for (const node of nodes ?? []) {
    visit(node, parentId);
    walkNodes(node.children ?? [], visit, node.id);
  }
}

function buildIdMap(nodes) {
  const byId = new Map();
  walkNodes(nodes, (node, parentId) => {
    byId.set(node.id, { node, parentId });
  });
  return byId;
}

function childrenByParent(nodes) {
  const rootKey = "__root__";
  const clean = new Map();
  clean.set(rootKey, (nodes ?? []).map((node) => node.id));
  walkNodes(nodes, (node) => {
    clean.set(node.id, (node.children ?? []).map((child) => child.id));
  });
  return { map: clean, rootKey };
}

function makeDraftCategoryNode({ name, categoryId = null }) {
  const trimmed = String(name ?? "").trim();
  return {
    id: takeTempId(),
    node_type: "category",
    name: trimmed,
    category_id: categoryId,
    parent_node_id: null,
    note_id: null,
    cover_note_id: null,
    position: null,
    note: null,
    cover_note: null,
    children: [],
    _pendingCategoryName: categoryId == null ? trimmed : null,
  };
}

function makeDraftGroupingNode({ name, parentId = null }) {
  const trimmed = String(name ?? "").trim();
  return {
    id: takeTempId(),
    node_type: "grouping",
    name: trimmed,
    category_id: null,
    parent_node_id: parentId,
    note_id: null,
    cover_note_id: null,
    position: null,
    note: null,
    cover_note: null,
    children: [],
  };
}

function makeDraftNoteNode({ note, parentId = null }) {
  return {
    id: takeTempId(),
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: parentId,
    note_id: note?.id ?? null,
    cover_note_id: null,
    position: null,
    note: note ?? { id: null },
    cover_note: null,
    children: [],
  };
}

// A Catalog entry is a leaf with its own metadata and an ordered specimen set;
// it mirrors the tree payload so the canvas can render it before Save.
function makeDraftCatalogEntryNode({
  entry,
  parentId = null,
  specimens = [],
  primaryNoteId = null,
}) {
  const specimenNotes = specimens.filter(Boolean);
  const primary = specimenNotes.some((note) => note?.id === primaryNoteId)
    ? primaryNoteId
    : (specimenNotes[0]?.id ?? null);

  return {
    id: takeTempId(),
    node_type: "catalog_entry",
    name: null,
    category_id: null,
    parent_node_id: parentId,
    note_id: null,
    cover_note_id: null,
    position: null,
    note: null,
    cover_note: null,
    entry: normalizeCatalogEntry(entry),
    specimens: specimenNotes,
    primary_note_id: primary,
    children: [],
  };
}

function sameIdList(left, right) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

// Replay a draft tree onto the server. New nodes carry negative ids; everything
// else is an existing id. Creations run parents-before-children (groupings,
// catalog entries, notes batched per parent), then deletions, updates,
// specimen sets, and reorders to the draft order.
async function saveShowcaseDraft({ showcaseId, baselineNodes, draftNodes, api }) {
  const {
    createShowcaseNode,
    createCatalogEntry,
    updateNode,
    updateCatalogEntry,
    updateNodeNotes,
    deleteNode,
    reorderNodes,
  } = api;
  const baselineById = buildIdMap(baselineNodes);
  const draftById = buildIdMap(draftNodes);

  const baselineIds = new Set(baselineById.keys());
  const draftIds = new Set(draftById.keys());

  const tempToReal = new Map();
  const creationOrderByParent = new Map();

  function recordCreation(realParentId, realId) {
    const key = realParentId ?? "__root__";
    if (!creationOrderByParent.has(key)) {
      creationOrderByParent.set(key, []);
    }
    creationOrderByParent.get(key).push(realId);
  }

  function realParentOf(draftParentId) {
    if (draftParentId == null) {
      return null;
    }
    if (isTempId(draftParentId)) {
      return tempToReal.get(draftParentId) ?? null;
    }
    return draftParentId;
  }

  function realParentOfNode(node) {
    return realParentOf(draftById.get(node.id)?.parentId ?? null);
  }

  // New categories first (roots, in draft order).
  for (const node of draftNodes ?? []) {
    if (!isTempId(node.id) || node.node_type !== "category") {
      continue;
    }
    const payload = node.category_id != null
      ? { type: "category", category_id: node.category_id }
      : { type: "category", name: node._pendingCategoryName ?? node.name };
    const { node: created } = await createShowcaseNode(showcaseId, payload);
    if (created?.id != null) {
      tempToReal.set(node.id, created.id);
      recordCreation(null, created.id);
    }
  }

  // New groupings breadth-first so parents exist before children.
  const bfs = [];
  const visitQueue = [...(draftNodes ?? [])];
  while (visitQueue.length) {
    const current = visitQueue.shift();
    bfs.push(current);
    for (const child of current.children ?? []) {
      visitQueue.push(child);
    }
  }
  for (const node of bfs) {
    if (!isTempId(node.id) || node.node_type !== "grouping") {
      continue;
    }
    const realParentId = realParentOfNode(node);
    if (realParentId == null) {
      continue;
    }
    const { node: created } = await createShowcaseNode(showcaseId, {
      type: "grouping",
      parent_id: realParentId,
      name: node.name,
    });
    if (created?.id != null) {
      tempToReal.set(node.id, created.id);
      recordCreation(realParentId, created.id);
    }
  }

  // New catalog entries follow the groupings, so a new Grouping parent already
  // has a real id. Creation carries the metadata and the ordered note_ids; the
  // server makes the first note primary, and the specimen phase below corrects
  // a draft that chose another one.
  for (const node of bfs) {
    if (!isTempId(node.id) || !isCatalogEntry(node)) {
      continue;
    }
    const realParentId = realParentOfNode(node);
    if (realParentId == null) {
      continue;
    }
    const { node: created } = await createCatalogEntry(showcaseId, {
      parentId: realParentId,
      entry: node.entry ?? {},
      noteIds: specimenPayload(node).note_ids,
    });
    if (created?.id != null) {
      tempToReal.set(node.id, created.id);
      recordCreation(realParentId, created.id);
    }
  }

  // New notes batched per parent, in draft order.
  const newNotesByParent = new Map();
  for (const [id, { node, parentId }] of draftById.entries()) {
    if (!isTempId(id) || node.node_type !== "note") {
      continue;
    }
    const realParentId = realParentOf(parentId);
    if (realParentId == null) {
      continue;
    }
    if (!newNotesByParent.has(realParentId)) {
      newNotesByParent.set(realParentId, []);
    }
    newNotesByParent.get(realParentId).push(node);
  }
  // Preserve draft order within each parent.
  for (const [realParentId, list] of newNotesByParent.entries()) {
    const parentDraftChildren = (() => {
      if (realParentId == null) {
        return draftNodes ?? [];
      }
      // Find draft parent (existing or new) to read child order.
      const draftParentEntry = [...draftById.entries()].find(([id]) => {
        if (isTempId(id)) {
          return tempToReal.get(id) === realParentId;
        }
        return id === realParentId;
      });
      const parentNode = draftParentEntry?.[1]?.node;
      if (!parentNode && realParentId != null) {
        // Top-level never holds notes; fallback to insertion order.
        return list;
      }
      return parentNode?.children ?? list;
    })();
    const ordered = parentDraftChildren.filter((child) =>
      list.some((entry) => entry.id === child.id),
    );
    const noteIds = ordered.map((child) => child.note_id).filter((v) => v != null);
    if (!noteIds.length) {
      continue;
    }
    const { nodes: created } = await createShowcaseNode(showcaseId, {
      type: "notes",
      parent_id: realParentId,
      note_ids: noteIds,
    });
    (created ?? []).forEach((createdNode, index) => {
      const draftNode = ordered[index];
      if (draftNode && createdNode?.id != null) {
        tempToReal.set(draftNode.id, createdNode.id);
        recordCreation(realParentId, createdNode.id);
      }
    });
  }

  const remapId = (id) => (isTempId(id) ? (tempToReal.get(id) ?? null) : id);

  // Deletions: baseline ids absent from the draft. Only the topmost of a
  // removed subtree is deleted; the cascade takes the rest.
  const deletedIds = [...baselineIds].filter((id) => {
    // A baseline id survives when the draft still holds it.
    if (draftIds.has(id)) {
      return false;
    }
    return true;
  });
  const deletedSet = new Set(deletedIds);
  const topmostDeleted = deletedIds.filter((id) => {
    let parentId = baselineById.get(id)?.parentId ?? null;
    while (parentId != null) {
      if (deletedSet.has(parentId)) {
        return false;
      }
      parentId = baselineById.get(parentId)?.parentId ?? null;
    }
    return true;
  });
  for (const id of topmostDeleted) {
    await deleteNode(id);
  }

  // Updates: renames and cover changes for surviving existing nodes.
  for (const [id, { node: draftNode }] of draftById.entries()) {
    if (isTempId(id) || !baselineIds.has(id) || deletedSet.has(id)) {
      continue;
    }
    const baselineNode = baselineById.get(id)?.node;
    if (!baselineNode) {
      continue;
    }
    if (
      (draftNode.node_type === "category" || draftNode.node_type === "grouping") &&
      (draftNode.name ?? null) !== (baselineNode.name ?? null)
    ) {
      await updateNode(id, { name: draftNode.name });
    }
    if (
      draftNode.node_type === "grouping" &&
      (draftNode.cover_note_id ?? null) !== (baselineNode.cover_note_id ?? null)
    ) {
      await updateNode(id, { cover_note_id: draftNode.cover_note_id ?? null });
    }
    if (
      isCatalogEntry(draftNode) &&
      !sameCatalogEntry(draftNode.entry, baselineNode.entry)
    ) {
      await updateCatalogEntry(id, draftNode.entry ?? {});
    }
  }

  // Cover set on newly created groupings (creation carries no cover).
  for (const [tempId, realId] of tempToReal.entries()) {
    const draftNode = draftById.get(tempId)?.node;
    if (draftNode?.node_type === "grouping" && draftNode.cover_note_id != null) {
      await updateNode(realId, { cover_note_id: draftNode.cover_note_id });
    }
  }

  // Specimen sets come after every creation. An existing entry whose ordered
  // set or primary changed issues one full-set call; a new entry needs one only
  // when its draft primary is not the first specimen it was created with.
  for (const [id, { node: draftNode }] of draftById.entries()) {
    if (!isCatalogEntry(draftNode)) {
      continue;
    }

    const payload = specimenPayload(draftNode);
    const [firstNoteId] = payload.note_ids;

    if (isTempId(id)) {
      const realId = tempToReal.get(id);
      if (realId == null) {
        continue;
      }
      if (firstNoteId != null && payload.primary_note_id !== firstNoteId) {
        await updateNodeNotes(realId, payload);
      }
      continue;
    }

    if (!baselineIds.has(id)) {
      continue;
    }

    const baselineNode = baselineById.get(id).node;
    const baselinePayload = specimenPayload(baselineNode);

    if (
      payload.primary_note_id === baselinePayload.primary_note_id &&
      sameIdList(payload.note_ids, baselinePayload.note_ids)
    ) {
      continue;
    }

    await updateNodeNotes(id, payload);
  }

  // Reorders: bring every parent's server order to the draft order.
  const { map: draftChildrenMap, rootKey } = childrenByParent(draftNodes);
  const { map: baselineChildrenMap } = childrenByParent(baselineNodes);

  const remappedDraftMap = new Map();
  for (const [parentId, childIds] of draftChildrenMap.entries()) {
    const remappedParent = isTempId(parentId) ? (tempToReal.get(parentId) ?? null) : parentId;
    const key = parentId === rootKey ? rootKey : (remappedParent ?? parentId);
    const remappedChildren = childIds.map(remapId).filter((v) => v != null);
    // Merge when several temp parents map oddly; normally one entry per key.
    if (parentId === rootKey) {
      remappedDraftMap.set(rootKey, remappedChildren);
    } else if (remappedParent != null) {
      remappedDraftMap.set(remappedParent, remappedChildren);
    }
  }

  const baselineMapByReal = new Map();
  for (const [parentId, childIds] of baselineChildrenMap.entries()) {
    if (parentId === rootKey) {
      baselineMapByReal.set(rootKey, childIds);
    } else {
      baselineMapByReal.set(parentId, childIds);
    }
  }

  for (const [parentKey, draftOrder] of remappedDraftMap.entries()) {
    const isRoot = parentKey === rootKey;
    const realParentId = isRoot ? null : parentKey;
    const baselineOrder = baselineMapByReal.get(parentKey) ?? [];
    const survivingBaseline = baselineOrder.filter((id) => !deletedSet.has(id));
    const createdOrder = creationOrderByParent.get(isRoot ? "__root__" : realParentId) ?? [];
    // Server order after creates/deletes: surviving baseline in old order plus
    // created ids appended in creation order.
    const serverOrder = [...survivingBaseline, ...createdOrder];

    if (sameIdList(serverOrder, draftOrder)) {
      continue;
    }
    // No reorder for a single child or empty level.
    if (draftOrder.length <= 1 && serverOrder.length <= 1) {
      continue;
    }
    // Root holds categories which have no drag reorder in the UI, but a
    // deletion still leaves the remainder in order; skip root reorders unless
    // the relative order actually changed.
    if (isRoot) {
      const draftFiltered = draftOrder.filter((id) => survivingBaseline.includes(id));
      const sameRelative =
        draftFiltered.length === survivingBaseline.length &&
        draftFiltered.every((id, index) => {
          // Compare against surviving baseline order restricted to ids still
          // present in the draft.
          const expected = survivingBaseline.filter((entry) => draftOrder.includes(entry));
          return id === expected[index];
        });
      // New root ids append at the end in draft order already; skip.
      const appendedAtEnd =
        draftOrder.slice(0, survivingBaseline.length).every((id, index) => {
          const expected = survivingBaseline.filter((entry) => draftOrder.includes(entry));
          return id === expected[index];
        });
      if (sameRelative && appendedAtEnd) {
        continue;
      }
    }
    await reorderNodes(showcaseId, realParentId, draftOrder);
  }

  return { tempToReal };
}

export {
  buildIdMap,
  childrenByParent,
  isTempId,
  makeDraftCategoryNode,
  makeDraftCatalogEntryNode,
  makeDraftGroupingNode,
  makeDraftNoteNode,
  resetTempIds,
  saveShowcaseDraft,
  takeTempId,
};
