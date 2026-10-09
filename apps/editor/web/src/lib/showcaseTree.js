// Pure helpers over a Showcase's nested node tree. The tree arrives from
// `GET /api/showcases/:id/tree` already nested and ordered, so these functions
// only walk, replace, remove, and append — they never read the network and hold
// no state. Keeping them here (beside `showcaseCovers.js`) lets the screen stay
// about rendering and lets the walkers be tested on plain objects.

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

export {
  appendChildren,
  applyChildOrder,
  countNoteNodes,
  findNodeById,
  findNodeIdPath,
  findNodePath,
  removeNodeTree,
  reorderNodeTree,
  updateNodeTree,
};
