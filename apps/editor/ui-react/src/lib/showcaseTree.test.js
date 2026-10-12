import { describe, expect, test } from "vitest";
import {
  appendChildren,
  applyChildOrder,
  countNoteNodes,
  findNodeById,
  findNodeIdPath,
  findNodePath,
  removeNodeTree,
  reorderNodeTree,
  updateNodeTree,
  visibleChildNodes,
} from "./showcaseTree.js";

function noteNode(id) {
  return { id, node_type: "note", name: null, children: [] };
}

function grouping(id, children = []) {
  return { id, node_type: "grouping", name: `Group ${id}`, children };
}

function category(id, children = []) {
  return { id, node_type: "category", name: `Category ${id}`, children };
}

// Category 1 > [Group 2 > note 4, note 3], category 5.
function tree() {
  return [
    category(1, [grouping(2, [noteNode(4)]), noteNode(3)]),
    category(5),
  ];
}

describe("findNodePath", () => {
  test("returns the nodes along an id chain", () => {
    const path = findNodePath(tree(), [1, 2, 4]);

    expect(path.map((node) => node.id)).toEqual([1, 2, 4]);
  });

  test("stops at the last resolvable level when an id is stale", () => {
    const path = findNodePath(tree(), [1, 999]);

    expect(path.map((node) => node.id)).toEqual([1]);
  });
});

describe("findNodeIdPath", () => {
  test("returns the id chain to a nested node", () => {
    expect(findNodeIdPath(tree(), 4)).toEqual([1, 2, 4]);
  });

  test("returns empty for an id not in the tree", () => {
    expect(findNodeIdPath(tree(), 999)).toEqual([]);
  });
});

describe("findNodeById", () => {
  test("finds a node at any depth", () => {
    expect(findNodeById(tree(), 4)?.id).toBe(4);
  });

  test("returns null for a missing node", () => {
    expect(findNodeById(tree(), 999)).toBeNull();
  });
});

describe("updateNodeTree", () => {
  test("replaces one nested node and keeps untouched references", () => {
    const before = tree();
    const after = updateNodeTree(before, 4, (node) => ({ ...node, seen: true }));

    expect(findNodeById(after, 4).seen).toBe(true);
    expect(findNodeById(after, 3)).toBe(before[0].children[1]);
    expect(after[1]).toBe(before[1]);
  });

  test("returns the same array when nothing changed", () => {
    const before = tree();

    expect(updateNodeTree(before, 999, (node) => node)).toBe(before);
  });
});

describe("removeNodeTree", () => {
  test("removes a nested node and its subtree", () => {
    const after = removeNodeTree(tree(), 2);

    expect(findNodeById(after, 2)).toBeNull();
    expect(findNodeById(after, 4)).toBeNull();
    expect(findNodeById(after, 3)?.id).toBe(3);
  });
});

describe("appendChildren", () => {
  test("appends to the matching parent anywhere in the tree", () => {
    const after = appendChildren(tree(), 2, [noteNode(6)]);

    expect(findNodeById(after, 2).children.map((node) => node.id)).toEqual([4, 6]);
  });
});

describe("applyChildOrder", () => {
  test("orders the known ids and keeps the omitted ones at the end", () => {
    const children = [noteNode(1), noteNode(2), noteNode(3)];

    expect(applyChildOrder(children, [3, 1]).map((node) => node.id)).toEqual([
      3, 1, 2,
    ]);
  });
});

describe("reorderNodeTree", () => {
  test("reorders the top level when the parent is null", () => {
    const after = reorderNodeTree(tree(), null, [5, 1]);

    expect(after.map((node) => node.id)).toEqual([5, 1]);
  });

  test("reorders a nested parent's children", () => {
    const after = reorderNodeTree(tree(), 1, [3, 2]);

    expect(findNodeById(after, 1).children.map((node) => node.id)).toEqual([
      3, 2,
    ]);
  });
});

describe("countNoteNodes", () => {
  test("counts note nodes at every depth", () => {
    expect(countNoteNodes(tree())).toBe(2);
  });

  test("is zero for an empty tree", () => {
    expect(countNoteNodes([])).toBe(0);
  });
});

describe("visibleChildNodes", () => {
  test("keeps everything in edit mode", () => {
    const children = [grouping(2), noteNode(3)];

    expect(visibleChildNodes(children, true)).toBe(children);
  });

  test("hides empty groupings in view mode but keeps notes", () => {
    const children = [grouping(2), noteNode(3)];

    expect(visibleChildNodes(children, false).map((node) => node.id)).toEqual([
      3,
    ]);
  });

  test("keeps a grouping with a nested note in view mode", () => {
    const children = [grouping(2, [grouping(6, [noteNode(7)])])];

    expect(visibleChildNodes(children, false).map((node) => node.id)).toEqual([
      2,
    ]);
  });

  test("hides a grouping holding only empty groupings in view mode", () => {
    const children = [grouping(2, [grouping(6)])];

    expect(visibleChildNodes(children, false)).toEqual([]);
  });
});
