import { describe, expect, test } from "vitest";
import {
  appendChildren,
  applyChildOrder,
  catalogCounts,
  catalogEntryLabel,
  catalogEntryState,
  catalogMergeKey,
  catalogPresentationNotes,
  countNoteNodes,
  filterCatalogTree,
  findNodeById,
  findNodeIdPath,
  findNodePath,
  hasCatalogEntries,
  hasSeenPrimary,
  nodeCatalogState,
  normalizeCatalogEntry,
  planCatalogMerge,
  primarySpecimen,
  removeNodeTree,
  reorderNodeTree,
  sameCatalogEntry,
  showcaseCountLabel,
  showcaseNoteState,
  specimenNoteIds,
  specimenPayload,
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

  test("keeps a grouping that holds a catalog entry with no specimens", () => {
    const children = [grouping(2, [entryNode(8, [])])];

    expect(visibleChildNodes(children, false).map((node) => node.id)).toEqual([
      2,
    ]);
  });
});

// ── Catalog fixtures ──────────────────────────────────────────────────────

function ownedSpecimen(id) {
  return { id, owned: true };
}

function seenSpecimen(id) {
  return { id, owned: false };
}

function entryNode(
  id,
  specimens,
  { catalogNumber = "22a", primaryId = null } = {},
) {
  return {
    id,
    node_type: "catalog_entry",
    entry: {
      catalog_number: catalogNumber,
      denomination: "20 lei",
      issue_date: "1877",
      source: "Pick catalog",
    },
    specimens,
    primary_note_id: primaryId ?? specimens[0]?.id ?? null,
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

// Category 1 > grouping 2 > owned entry 20, seen entry 21; unseen entry 22 and
// owned note leaf 3 under category 1; category 5 > grouping 6 > seen entry 23,
// seen note leaf 4.
function catalogTree() {
  return [
    category(1, [
      grouping(2, [entryNode(20, [ownedSpecimen(201)]), entryNode(21, [seenSpecimen(211)])]),
      entryNode(22, []),
      noteLeaf(3, true),
    ]),
    category(5, [grouping(6, [entryNode(23, [seenSpecimen(231)])]), noteLeaf(4, false)]),
  ];
}

describe("catalogEntryState", () => {
  test("an entry with no specimens is unseen", () => {
    expect(catalogEntryState(entryNode(20, []))).toBe("unseen");
  });

  test("an entry whose specimens are all unowned is seen", () => {
    expect(catalogEntryState(entryNode(21, [seenSpecimen(211), seenSpecimen(212)]))).toBe(
      "seen",
    );
  });

  test("any owned specimen makes the entry owned", () => {
    expect(catalogEntryState(entryNode(22, [seenSpecimen(221), ownedSpecimen(222)]))).toBe(
      "owned",
    );
  });

  test("the primary specimen never decides ownership", () => {
    const entry = entryNode(30, [ownedSpecimen(301), seenSpecimen(302)], {
      primaryId: 302,
    });

    expect(entry.primary_note_id).toBe(302);
    expect(catalogEntryState(entry)).toBe("owned");
  });
});

describe("showcaseNoteState", () => {
  test("a note leaf follows the note's owned flag", () => {
    expect(showcaseNoteState(noteLeaf(3, true))).toBe("owned");
    expect(showcaseNoteState(noteLeaf(4, false))).toBe("seen");
  });
});

describe("specimenNoteIds", () => {
  test("reads the ordered ids off a catalog entry", () => {
    expect(specimenNoteIds(entryNode(20, [ownedSpecimen(201), seenSpecimen(202)]))).toEqual([
      201, 202,
    ]);
  });

  test("is empty for a node without specimens", () => {
    expect(specimenNoteIds(noteNode(3))).toEqual([]);
    expect(specimenNoteIds(entryNode(20, []))).toEqual([]);
  });
});

describe("specimenPayload", () => {
  test("carries the ordered ids and the stored primary", () => {
    expect(
      specimenPayload(
        entryNode(20, [ownedSpecimen(201), seenSpecimen(202)], {
          primaryId: 202,
        }),
      ),
    ).toEqual({ note_ids: [201, 202], primary_note_id: 202 });
  });

  test("falls back to the first specimen when the primary is stale", () => {
    expect(
      specimenPayload(
        entryNode(20, [ownedSpecimen(201), seenSpecimen(202)], {
          primaryId: 999,
        }),
      ),
    ).toEqual({ note_ids: [201, 202], primary_note_id: 201 });
  });

  test("clears the set without a primary", () => {
    expect(specimenPayload(entryNode(20, []))).toEqual({ note_ids: [] });
  });
});

describe("primarySpecimen", () => {
  test("returns the stored primary note", () => {
    expect(
      primarySpecimen(
        entryNode(20, [ownedSpecimen(201), seenSpecimen(202)], {
          primaryId: 202,
        }),
      ),
    ).toEqual(seenSpecimen(202));
  });

  test("falls back to the first specimen", () => {
    expect(
      primarySpecimen(
        entryNode(20, [ownedSpecimen(201), seenSpecimen(202)], {
          primaryId: 999,
        }),
      ),
    ).toEqual(ownedSpecimen(201));
  });

  test("is null for an empty entry", () => {
    expect(primarySpecimen(entryNode(20, []))).toBeNull();
  });
});

describe("hasSeenPrimary", () => {
  test("is true for an owned entry presenting an unowned reference", () => {
    expect(
      hasSeenPrimary(
        entryNode(30, [ownedSpecimen(301), seenSpecimen(302)], {
          primaryId: 302,
        }),
      ),
    ).toBe(true);
  });

  test("is false when the primary is owned or the entry is not", () => {
    expect(
      hasSeenPrimary(
        entryNode(30, [ownedSpecimen(301), seenSpecimen(302)], {
          primaryId: 301,
        }),
      ),
    ).toBe(false);
    expect(hasSeenPrimary(entryNode(31, [seenSpecimen(311)]))).toBe(false);
    expect(hasSeenPrimary(entryNode(32, []))).toBe(false);
  });
});

describe("nodeCatalogState", () => {
  test("answers for entries and note leaves but not containers", () => {
    expect(nodeCatalogState(entryNode(20, []))).toBe("unseen");
    expect(nodeCatalogState(noteLeaf(3, true))).toBe("owned");
    expect(nodeCatalogState(category(1))).toBeNull();
    expect(nodeCatalogState(grouping(2))).toBeNull();
  });
});

describe("normalizeCatalogEntry and sameCatalogEntry", () => {
  test("normalizes the four metadata fields to trimmed strings", () => {
    expect(
      normalizeCatalogEntry({
        catalog_number: " 22a ",
        denomination: " 20 lei",
        issue_date: "1877 ",
      }),
    ).toEqual({
      catalog_number: "22a",
      denomination: "20 lei",
      issue_date: "1877",
      source: "",
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
  test("keeps one slide per owned card and skips seen and unseen", () => {
    const tree = [
      category(1, [
        grouping(2, [
          entryNode(20, [ownedSpecimen(201)], { primaryId: 201 }),
          entryNode(21, [seenSpecimen(211)]),
          entryNode(22, []),
        ]),
        noteLeaf(3, true),
        noteLeaf(4, false),
      ]),
    ];

    expect(
      catalogPresentationNotes(tree).map((slide) => slide.nodeId),
    ).toEqual([20, 3]);
  });

  test("a slide carries the entry's primary note", () => {
    const tree = [
      entryNode(30, [ownedSpecimen(301), ownedSpecimen(302)], {
        primaryId: 302,
      }),
    ];

    expect(catalogPresentationNotes(tree)).toEqual([
      { nodeId: 30, note: ownedSpecimen(302) },
    ]);
  });
});

describe("catalogCounts", () => {
  test("counts entries and note leaves by state at every depth", () => {
    expect(catalogCounts(catalogTree())).toEqual({
      owned: 2,
      seen: 3,
      unseen: 1,
      total: 6,
      complete: false,
    });
  });

  test("is complete only when nothing is seen or unseen", () => {
    const tree = [
      category(1, [entryNode(20, [ownedSpecimen(201)]), noteLeaf(3, true)]),
    ];

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

describe("hasCatalogEntries", () => {
  test("finds an entry at any depth", () => {
    expect(hasCatalogEntries(catalogTree())).toBe(true);
  });

  test("is false for a presentation of note leaves", () => {
    expect(hasCatalogEntries([category(1, [noteNode(3)])])).toBe(false);
  });
});

describe("filterCatalogTree", () => {
  test("all hands the tree back untouched", () => {
    const tree = catalogTree();

    expect(filterCatalogTree(tree, "all")).toBe(tree);
  });

  test("keeps owned cards and the groupings that hold them", () => {
    const filtered = filterCatalogTree(catalogTree(), "owned");

    expect(findNodeById(filtered, 20)?.id).toBe(20);
    expect(findNodeById(filtered, 21)).toBeNull();
    expect(findNodeById(filtered, 2)).not.toBeNull();
    expect(findNodeById(filtered, 3)?.id).toBe(3);
    expect(findNodeById(filtered, 5)).toBeNull();
  });

  test("keeps a matching unseen entry and drops the grouping around it", () => {
    const filtered = filterCatalogTree(catalogTree(), "unseen");

    expect(findNodeById(filtered, 22)?.id).toBe(22);
    expect(findNodeById(filtered, 2)).toBeNull();
    expect(findNodeById(filtered, 5)).toBeNull();
  });

  test("keeps seen entries under their grouping", () => {
    const filtered = filterCatalogTree(catalogTree(), "seen");

    expect(findNodeById(filtered, 6)?.children.map((node) => node.id)).toEqual([
      23,
    ]);
    expect(findNodeById(filtered, 2)?.children.map((node) => node.id)).toEqual([
      21,
    ]);
    expect(findNodeById(filtered, 4)?.id).toBe(4);
  });

  test("returns an empty tree when nothing matches", () => {
    expect(filterCatalogTree([category(1, [noteLeaf(3, true)])], "unseen")).toEqual(
      [],
    );
  });

  test("drops an empty sibling grouping but keeps the matching branch", () => {
    const tree = [
      category(1, [
        grouping(2, [entryNode(20, [ownedSpecimen(201)])]),
        grouping(3, [entryNode(21, [seenSpecimen(211)])]),
        entryNode(22, []),
      ]),
    ];
    const filtered = filterCatalogTree(tree, "unseen");

    expect(filtered[0].children.map((node) => node.id)).toEqual([22]);
  });
});

describe("catalogEntryLabel", () => {
  test("names the entry by catalog value, denomination, and date", () => {
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

describe("catalogMergeKey", () => {
  test("trims, lowercases, and strips a Pick prefix", () => {
    expect(catalogMergeKey("  Pick 22A ")).toBe("22a");
    expect(catalogMergeKey("22a")).toBe("22a");
  });

  test("treats a bare P prefix as the same Pick formatting", () => {
    expect(catalogMergeKey("P22a")).toBe("22a");
  });

  test("keeps exact values apart", () => {
    expect(catalogMergeKey("22a")).not.toBe(catalogMergeKey("22b"));
  });

  test("is empty for a missing catalog number", () => {
    expect(catalogMergeKey("  ")).toBe("");
  });
});

describe("planCatalogMerge", () => {
  test("appends notes to the existing entry with the same catalog value", () => {
    const children = [entryNode(20, [ownedSpecimen(101)], {
      catalogNumber: "Pick 22a",
      primaryId: 101,
    })];
    const plan = planCatalogMerge(children, [
      { id: 102, catalog_number: "22a", denomination: "20 lei", issue_date: "1877" },
      { id: 103, catalog_number: " pick 22A " },
    ]);

    expect(plan.additions).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.merges).toEqual([
      {
        nodeId: 20,
        noteIds: [101, 102, 103],
        primaryNoteId: 101,
        addedNoteIds: [102, 103],
      },
    ]);
  });

  test("creates one new entry per exact catalog value", () => {
    const plan = planCatalogMerge([], [
      { id: 201, catalog_number: "22a", denomination: "20 lei", issue_date: "1877" },
      { id: 202, catalog_number: "22b", denomination: "20 lei", issue_date: "1877" },
      { id: 203, catalog_number: "22A" },
    ]);

    expect(plan.additions.map((addition) => addition.noteIds)).toEqual([
      [201, 203],
      [202],
    ]);
    expect(plan.additions[0].entry).toEqual({
      catalog_number: "22a",
      denomination: "20 lei",
      issue_date: "1877",
      source: "",
    });
  });

  test("skips notes without a catalog number", () => {
    const plan = planCatalogMerge([], [{ id: 301, catalog_number: "" }]);

    expect(plan.additions).toEqual([]);
    expect(plan.skipped).toEqual([
      { note: { id: 301, catalog_number: "" }, reason: "no-catalog-number" },
    ]);
  });

  test("skips notes already attached to the matching entry", () => {
    const children = [entryNode(20, [ownedSpecimen(101)])];
    const plan = planCatalogMerge(children, [{ id: 101, catalog_number: "22a" }]);

    expect(plan.merges).toEqual([]);
    expect(plan.skipped).toEqual([
      { note: { id: 101, catalog_number: "22a" }, reason: "already-on-entry" },
    ]);
  });

  test("keeps an existing primary and promotes the first note when it is gone", () => {
    const withPrimary = planCatalogMerge(
      [entryNode(20, [ownedSpecimen(101)], { primaryId: 101 })],
      [{ id: 102, catalog_number: "22a" }],
    );
    const withStalePrimary = planCatalogMerge(
      [entryNode(20, [ownedSpecimen(101), ownedSpecimen(102)], {
        primaryId: 999,
      })],
      [{ id: 103, catalog_number: "22a" }],
    );

    expect(withPrimary.merges[0].primaryNoteId).toBe(101);
    expect(withStalePrimary.merges[0].primaryNoteId).toBe(101);
  });

  test("reports a draft entry id unchanged so the caller merges locally", () => {
    const plan = planCatalogMerge(
      [entryNode(-4, [ownedSpecimen(101)], { primaryId: 101 })],
      [{ id: 102, catalog_number: "22a" }],
    );

    expect(plan.merges[0].nodeId).toBe(-4);
    expect(plan.merges[0].noteIds).toEqual([101, 102]);
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
