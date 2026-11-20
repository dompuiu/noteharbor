import { describe, expect, test } from "vitest";
import {
  appendChildren,
  appendPositionFor,
  applyChildOrder,
  catalogCounts,
  catalogEntryCaption,
  catalogEntryIdentity,
  catalogEntryLabel,
  catalogEntryState,
  catalogPresentationNotes,
  countNoteNodes,
  filterCatalogTree,
  findNodeById,
  findNodeIdForNote,
  findNodeIdPath,
  findNodePath,
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
  showcaseNoteState,
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

describe("appendPositionFor", () => {
  test("counts the list as it stands after the source leaves", () => {
    const children = [grouping(2), noteNode(3), noteNode(4)];

    expect(appendPositionFor(children, 3)).toBe(2);
    expect(appendPositionFor(children, 99)).toBe(3);
  });
});

describe("showcaseNodeLabel", () => {
  test("names a grouping by its own name", () => {
    expect(showcaseNodeLabel(grouping(2))).toBe("Group 2");
  });

  test("names a note by its display parts", () => {
    const node = {
      ...noteNode(3),
      note: { denomination: "1 leu", issue_date: "1915" },
    };

    expect(showcaseNodeLabel(node)).toContain("1 leu");
  });
});

describe("moveNodeTree", () => {
  test("reparents a note into a grouping at the requested index", () => {
    const before = tree();
    const after = moveNodeTree(before, 3, 2, 1);

    expect(findNodeById(after, 1).children.map((node) => node.id)).toEqual([2]);
    expect(findNodeById(after, 2).children.map((node) => node.id)).toEqual([
      4, 3,
    ]);
    // The caller's tree is untouched.
    expect(findNodeById(before, 2).children.map((node) => node.id)).toEqual([4]);
  });

  test("moves a grouping to the top level", () => {
    const after = moveNodeTree(tree(), 2, null, 0);

    expect(after.map((node) => node.id)).toEqual([2, 1, 5]);
    expect(findNodeById(after, 1).children.map((node) => node.id)).toEqual([3]);
  });

  test("clamps the index to the target list", () => {
    const after = moveNodeTree(tree(), 3, 2, 99);

    expect(findNodeById(after, 2).children.map((node) => node.id)).toEqual([
      4, 3,
    ]);
  });

  test("refuses a target inside the moved subtree", () => {
    const before = tree();

    expect(moveNodeTree(before, 1, 2, 0)).toBe(before);
  });

  test("returns the tree unchanged for a missing node", () => {
    const before = tree();

    expect(moveNodeTree(before, 999, 2, 0)).toBe(before);
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

  test("keeps a grouping that holds a catalog entry", () => {
    const children = [grouping(2, [entryNode(8)])];

    expect(visibleChildNodes(children, false).map((node) => node.id)).toEqual([
      2,
    ]);
  });
});

// ── Catalog fixtures ──────────────────────────────────────────────────────

function entryNode(id, { catalogNumber = "22a" } = {}) {
  return {
    id,
    node_type: "catalog_entry",
    entry: {
      catalog_number: catalogNumber,
      denomination: "20 lei",
      issue_date: "1877",
      source: "Pick catalog",
    },
    children: [],
  };
}

function noteLeaf(id, owned) {
  return {
    id,
    node_type: "note",
    note: { id: id + 100, owned },
    children: [],
  };
}

// Category 1 > grouping 2 > shells 20 and 21; shell 22 and owned note leaf 3
// under category 1; category 5 > grouping 6 > shell 23, seen note leaf 4.
function catalogTree() {
  return [
    category(1, [
      grouping(2, [entryNode(20), entryNode(21)]),
      entryNode(22),
      noteLeaf(3, true),
    ]),
    category(5, [grouping(6, [entryNode(23)]), noteLeaf(4, false)]),
  ];
}

describe("catalogEntryState", () => {
  test("a planned shell is always unseen", () => {
    expect(catalogEntryState(entryNode(20))).toBe("unseen");
    expect(catalogEntryState(entryNode(21))).toBe("unseen");
  });
});

describe("showcaseNoteState", () => {
  test("a note leaf follows the note's owned flag", () => {
    expect(showcaseNoteState(noteLeaf(3, true))).toBe("owned");
    expect(showcaseNoteState(noteLeaf(4, false))).toBe("seen");
  });
});

describe("nodeCatalogState", () => {
  test("answers for entries and note leaves but not containers", () => {
    expect(nodeCatalogState(entryNode(20))).toBe("unseen");
    expect(nodeCatalogState(noteLeaf(3, true))).toBe("owned");
    expect(nodeCatalogState(category(1))).toBeNull();
    expect(nodeCatalogState(grouping(2))).toBeNull();
  });
});

describe("normalizeCatalogEntry and sameCatalogEntry", () => {
  test("normalizes the five metadata fields to trimmed strings", () => {
    expect(
      normalizeCatalogEntry({
        catalog_number: " 22a ",
        denomination: " 20 lei",
        issue_date: "1877 ",
        notes: " Watch the overprint. ",
      }),
    ).toEqual({
      catalog_number: "22a",
      denomination: "20 lei",
      issue_date: "1877",
      source: "",
      notes: "Watch the overprint.",
    });
  });

  test("compares metadata ignoring surrounding whitespace", () => {
    expect(
      sameCatalogEntry(
        { catalog_number: " 22a", denomination: "20 lei" },
        { catalog_number: "22a ", denomination: "20 lei " },
      ),
    ).toBe(true);
    expect(
      sameCatalogEntry({ catalog_number: "22a" }, { catalog_number: "22b" }),
    ).toBe(false);
  });
});

describe("catalogPresentationNotes", () => {
  test("keeps one slide per owned note leaf and skips seen notes and shells", () => {
    const tree = [
      category(1, [
        grouping(2, [entryNode(20), noteLeaf(5, true)]),
        noteLeaf(3, true),
        noteLeaf(4, false),
      ]),
    ];

    expect(
      catalogPresentationNotes(tree).map((slide) => slide.nodeId),
    ).toEqual([5, 3]);
  });

  test("a slide carries the leaf's own note", () => {
    const tree = [entryNode(30), noteLeaf(7, true)];

    expect(catalogPresentationNotes(tree)).toEqual([
      { nodeId: 7, note: noteLeaf(7, true).note },
    ]);
  });
});

describe("catalogCounts", () => {
  test("counts entries and note leaves by state at every depth", () => {
    expect(catalogCounts(catalogTree())).toEqual({
      owned: 1,
      seen: 1,
      unseen: 4,
      total: 6,
      complete: false,
    });
  });

  test("is complete only when nothing is seen or unseen", () => {
    const tree = [category(1, [noteLeaf(3, true), noteLeaf(5, true)])];

    expect(catalogCounts(tree)).toMatchObject({
      owned: 2,
      seen: 0,
      unseen: 0,
      complete: true,
    });
  });

  test("an empty tree is not complete", () => {
    expect(catalogCounts([])).toMatchObject({
      total: 0,
      complete: false,
    });
  });
});

describe("filterCatalogTree", () => {
  test("all hands the tree back untouched", () => {
    const tree = catalogTree();

    expect(filterCatalogTree(tree, "all")).toBe(tree);
  });

  test("keeps owned note leaves and drops the groupings around them", () => {
    const filtered = filterCatalogTree(catalogTree(), "owned");

    expect(findNodeById(filtered, 3)?.id).toBe(3);
    expect(findNodeById(filtered, 2)).toBeNull();
    expect(findNodeById(filtered, 20)).toBeNull();
    expect(findNodeById(filtered, 5)).toBeNull();
  });

  test("keeps every shell and drops the note leaves", () => {
    const filtered = filterCatalogTree(catalogTree(), "unseen");

    expect(findNodeById(filtered, 22)?.id).toBe(22);
    expect(findNodeById(filtered, 2)?.children.map((node) => node.id)).toEqual([
      20, 21,
    ]);
    expect(findNodeById(filtered, 3)).toBeNull();
    expect(findNodeById(filtered, 4)).toBeNull();
  });

  test("keeps seen note leaves", () => {
    const filtered = filterCatalogTree(catalogTree(), "seen");

    expect(findNodeById(filtered, 4)?.id).toBe(4);
    expect(findNodeById(filtered, 6)).toBeNull();
    expect(findNodeById(filtered, 3)).toBeNull();
  });

  test("returns an empty tree when nothing matches", () => {
    expect(filterCatalogTree([category(1, [noteLeaf(3, true)])], "unseen")).toEqual(
      [],
    );
  });

  test("drops an empty sibling grouping but keeps the matching branch", () => {
    const tree = [
      category(1, [
        grouping(2, [noteLeaf(6, false)]),
        grouping(3, [noteLeaf(7, true)]),
        entryNode(22),
      ]),
    ];
    const filtered = filterCatalogTree(tree, "unseen");

    expect(filtered[0].children.map((node) => node.id)).toEqual([22]);
  });
});

describe("catalogEntryIdentity", () => {
  test("keeps only the catalog value, with the denomination as fallback", () => {
    expect(catalogEntryIdentity({ catalog_number: "P22a" })).toBe("Pick 22a");
    expect(catalogEntryIdentity({ denomination: "20 lei" })).toBe("20 lei");
    expect(catalogEntryIdentity({})).toBe("Unidentified");
  });
});

describe("catalogEntryCaption", () => {
  test("reads catalog · date · denomination, with the compact form on request", () => {
    const entry = {
      catalog_number: "17",
      denomination: "1 Leu",
      issue_date: "03/12/1915",
    };

    expect(catalogEntryCaption(entry)).toBe("Pick 17 · 03/12/1915 · 1 Leu");
    expect(catalogEntryCaption(entry, { compact: true })).toBe(
      "P17 · 03/12/1915 · 1 Leu",
    );
  });

  test("falls back to the identity when the entry carries no details", () => {
    expect(catalogEntryCaption({})).toBe("Unidentified");
    expect(catalogEntryCaption(null)).toBe("Unidentified");
  });
});

describe("catalogEntryLabel", () => {  test("names the entry by catalog value, denomination, and date", () => {
    expect(
      catalogEntryLabel({
        catalog_number: "22a",
        denomination: "20 lei",
        issue_date: "1877",
        source: "Pick catalog",
      }),
    ).toBe("Pick 22a, 20 lei, 1877");
  });

  test("normalizes an existing Pick prefix", () => {
    expect(catalogEntryLabel({ catalog_number: "P22a" })).toBe("Pick 22a");
  });

  test("falls back to the denomination and then to Unidentified", () => {
    expect(catalogEntryLabel({ denomination: "20 lei" })).toBe("20 lei");
    expect(catalogEntryLabel({})).toBe("Unidentified");
  });
});

describe("showcaseCountLabel", () => {
  test("a catalog showcase prints owned over entry count", () => {
    expect(
      showcaseCountLabel({
        note_count: 3,
        entry_count: 11,
        owned_count: 8,
        catalog_entry_count: 11,
      }),
    ).toBe("8 / 11");
  });

  test("a presentation-only showcase keeps the note count", () => {
    expect(
      showcaseCountLabel({
        note_count: 12,
        entry_count: 0,
        owned_count: 0,
        catalog_entry_count: 0,
      }),
    ).toBe("12");
  });

  test("a payload without counts falls back", () => {
    expect(showcaseCountLabel({ name: "Draft" })).toBeNull();
    expect(showcaseCountLabel(null)).toBeNull();
  });
});

describe("findNodeIdForNote", () => {
  test("finds the note leaf that shows the note", () => {
    const tree = [category(1, [entryNode(20), noteLeaf(3, true)])];

    expect(findNodeIdForNote(tree, 103)).toBe(3);
    expect(findNodeIdForNote(tree, 999)).toBeNull();
  });
});

describe("noteOwnedInTree", () => {
  test("reads the live flag from the note leaf", () => {
    const tree = [category(1, [entryNode(20), noteLeaf(3, true)])];

    expect(noteOwnedInTree(tree, 103)).toBe(true);
    expect(noteOwnedInTree(tree, 999)).toBeUndefined();
  });
});

describe("setNoteOwned", () => {
  test("marks every note leaf that shows the note", () => {
    const tree = [category(1, [entryNode(20), noteLeaf(3, false)])];
    const next = setNoteOwned(tree, 103, true);

    expect(next).not.toBe(tree);
    expect(next[0].children[1].note).toEqual({ id: 103, owned: true });
    expect(next[0].children[0]).toBe(tree[0].children[0]);
  });

  test("marks a note leaf by the Note's own id", () => {
    const tree = [category(1, [noteLeaf(3, true)])];
    const next = setNoteOwned(tree, 103, false);

    expect(next[0].children[0].note).toEqual({ id: 103, owned: false });
  });

  test("keeps the same tree when nothing carries the flag", () => {
    const tree = [category(1, [noteLeaf(3, true)])];

    expect(setNoteOwned(tree, 999, false)).toBe(tree);
    expect(setNoteOwned(tree, 103, true)).toBe(tree);
  });
});
