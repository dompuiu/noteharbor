import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  isTempId,
  makeDraftCategoryNode,
  makeDraftCatalogEntryNode,
  makeDraftGroupingNode,
  makeDraftNoteNode,
  resetTempIds,
  saveShowcaseDraft,
} from "./showcaseDraft.js";

function api() {
  return {
    createShowcaseNode: vi.fn(async (_showcaseId, payload) => {
      if (payload.type === "notes") {
        return {
          nodes: payload.note_ids.map((noteId, index) => ({
            id: 1000 + noteId,
            node_type: "note",
            note_id: noteId,
            children: [],
            _order: index,
          })),
        };
      }
      return { node: { id: Math.floor(Math.random() * -1) || 900, ...payload } };
    }),
    createCatalogEntry: vi.fn(async (_showcaseId, payload) => ({
      node: { id: 801, node_type: "catalog_entry", ...payload },
    })),
    updateNode: vi.fn(async () => ({ node: {} })),
    updateCatalogEntry: vi.fn(async () => ({ node: {} })),
    updateNodeNotes: vi.fn(async () => ({ node: {} })),
    deleteNode: vi.fn(async () => ({ success: true })),
    reorderNodes: vi.fn(async () => ({ nodes: [] })),
  };
}

beforeEach(() => {
  resetTempIds();
});

describe("draft node makers", () => {
  test("new nodes carry temporary ids", () => {
    const category = makeDraftCategoryNode({ name: "Winter" });
    const grouping = makeDraftGroupingNode({ name: "Sub", parentId: 10 });
    const note = makeDraftNoteNode({ note: { id: 5 }, parentId: 10 });

    expect(isTempId(category.id)).toBe(true);
    expect(isTempId(grouping.id)).toBe(true);
    expect(isTempId(note.id)).toBe(true);
    expect(isTempId(10)).toBe(false);
  });

  test("a new catalog entry carries its metadata and the first specimen as primary", () => {
    const entry = makeDraftCatalogEntryNode({
      entry: { catalog_number: " 22a ", denomination: "20 lei", issue_date: "1877" },
      parentId: 10,
      specimens: [{ id: 101 }, { id: 102 }],
    });

    expect(isTempId(entry.id)).toBe(true);
    expect(entry.node_type).toBe("catalog_entry");
    expect(entry.entry).toEqual({
      catalog_number: "22a",
      denomination: "20 lei",
      issue_date: "1877",
      source: "",
    });
    expect(entry.primary_note_id).toBe(101);
    expect(entry.children).toEqual([]);
  });

  test("a new catalog entry keeps a chosen primary", () => {
    const entry = makeDraftCatalogEntryNode({
      entry: { catalog_number: "22a" },
      parentId: 10,
      specimens: [{ id: 101 }, { id: 102 }],
      primaryNoteId: 102,
    });

    expect(entry.primary_note_id).toBe(102);
  });
});

describe("saveShowcaseDraft", () => {
  test("an empty diff calls nothing", async () => {
    const mocks = api();
    const nodes = [
      { id: 10, node_type: "category", name: "Summer", category_id: 1, children: [] },
    ];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: nodes,
      draftNodes: structuredClone(nodes),
      api: mocks,
    });

    expect(mocks.createShowcaseNode).not.toHaveBeenCalled();
    expect(mocks.updateNode).not.toHaveBeenCalled();
    expect(mocks.deleteNode).not.toHaveBeenCalled();
    expect(mocks.reorderNodes).not.toHaveBeenCalled();
  });

  test("a new label placement posts by name", async () => {
    const mocks = api();
    mocks.createShowcaseNode.mockResolvedValueOnce({
      node: { id: 50, node_type: "category", name: "Winter" },
    });
    const draft = makeDraftCategoryNode({ name: "Winter" });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [],
      draftNodes: [draft],
      api: mocks,
    });

    expect(mocks.createShowcaseNode).toHaveBeenCalledWith(1, {
      type: "category",
      name: "Winter",
    });
  });

  test("reusing an existing label posts by category id", async () => {
    const mocks = api();
    mocks.createShowcaseNode.mockResolvedValueOnce({
      node: { id: 51, node_type: "category", name: "Vienna" },
    });
    const draft = makeDraftCategoryNode({ name: "Vienna", categoryId: 2 });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [],
      draftNodes: [draft],
      api: mocks,
    });

    expect(mocks.createShowcaseNode).toHaveBeenCalledWith(1, {
      type: "category",
      category_id: 2,
    });
  });

  test("a rename posts an update and a removal posts a delete", async () => {
    const mocks = api();
    const baseline = [
      { id: 10, node_type: "category", name: "Summer", category_id: 1, children: [] },
      { id: 11, node_type: "category", name: "Gone", category_id: 9, children: [] },
    ];
    const draft = [
      { id: 10, node_type: "category", name: "Monsoon", category_id: 1, children: [] },
    ];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.updateNode).toHaveBeenCalledWith(10, { name: "Monsoon" });
    expect(mocks.deleteNode).toHaveBeenCalledWith(11);
  });

  test("a reorder posts the draft order", async () => {
    const mocks = api();
    const child = (id) => ({
      id,
      node_type: "note",
      note_id: id,
      children: [],
    });
    const baseline = [
      {
        id: 10,
        node_type: "category",
        name: "Summer",
        category_id: 1,
        children: [child(11), child(12)],
      },
    ];
    const draft = [
      {
        id: 10,
        node_type: "category",
        name: "Summer",
        category_id: 1,
        children: [child(12), child(11)],
      },
    ];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.reorderNodes).toHaveBeenCalledWith(1, 10, [12, 11]);
  });

  test("a top-level category reorder posts a null-parent order", async () => {
    const mocks = api();
    const category = (id, name) => ({
      id,
      node_type: "category",
      name,
      category_id: id,
      children: [],
    });
    const baseline = [category(10, "Summer"), category(11, "Winter")];
    const draft = [category(11, "Winter"), category(10, "Summer")];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.reorderNodes).toHaveBeenCalledWith(1, null, [11, 10]);
  });

  test("new notes under a parent post one batch", async () => {
    const mocks = api();
    const parent = {
      id: 10,
      node_type: "category",
      name: "Summer",
      category_id: 1,
      children: [],
    };
    const draft = {
      ...parent,
      children: [
        { id: -1, node_type: "note", note_id: 101, note: { id: 101 }, children: [] },
        { id: -2, node_type: "note", note_id: 102, note: { id: 102 }, children: [] },
      ],
    };

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [parent],
      draftNodes: [draft],
      api: mocks,
    });

    expect(mocks.createShowcaseNode).toHaveBeenCalledWith(1, {
      type: "notes",
      parent_id: 10,
      note_ids: [101, 102],
    });
  });
});

// ── Catalog entries ──────────────────────────────────────────────────────

function catalogEntryNode(id, { noteIds = [], primaryId = null, entry = {} } = {}) {
  return {
    id,
    node_type: "catalog_entry",
    parent_node_id: 10,
    entry: {
      catalog_number: "22a",
      denomination: "20 lei",
      issue_date: "1877",
      source: "Pick catalog",
      ...entry,
    },
    specimens: noteIds.map((noteId) => ({ id: noteId, owned: true })),
    primary_note_id: primaryId ?? noteIds[0] ?? null,
    children: [],
  };
}

function categoryWith(children) {
  return {
    id: 10,
    node_type: "category",
    name: "Summer",
    category_id: 1,
    children,
  };
}

describe("saveShowcaseDraft catalog entries", () => {
  test("a new entry posts its metadata and ordered note ids", async () => {
    const mocks = api();
    const entry = makeDraftCatalogEntryNode({
      entry: { catalog_number: "22a", denomination: "20 lei", issue_date: "1877" },
      parentId: 10,
      specimens: [{ id: 101 }, { id: 102 }],
    });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [categoryWith([])],
      draftNodes: [categoryWith([entry])],
      api: mocks,
    });

    expect(mocks.createCatalogEntry).toHaveBeenCalledWith(1, {
      parentId: 10,
      entry: {
        catalog_number: "22a",
        denomination: "20 lei",
        issue_date: "1877",
        source: "",
      },
      noteIds: [101, 102],
    });
    expect(mocks.updateNodeNotes).not.toHaveBeenCalled();
    expect(mocks.updateCatalogEntry).not.toHaveBeenCalled();
  });

  test("a new entry created with another primary promotes it right after", async () => {
    const mocks = api();
    const entry = makeDraftCatalogEntryNode({
      entry: { catalog_number: "22a" },
      parentId: 10,
      specimens: [{ id: 101 }, { id: 102 }],
      primaryNoteId: 102,
    });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [categoryWith([])],
      draftNodes: [categoryWith([entry])],
      api: mocks,
    });

    expect(mocks.updateNodeNotes).toHaveBeenCalledWith(801, {
      note_ids: [101, 102],
      primary_note_id: 102,
    });
  });

  test("a changed specimen set issues the full-set call", async () => {
    const mocks = api();
    const baseline = [categoryWith([catalogEntryNode(20, { noteIds: [101] })])];
    const draft = structuredClone(baseline);
    draft[0].children[0].specimens.push({ id: 102, owned: true });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.updateNodeNotes).toHaveBeenCalledWith(20, {
      note_ids: [101, 102],
      primary_note_id: 101,
    });
  });

  test("a changed primary alone issues the full-set call", async () => {
    const mocks = api();
    const baseline = [
      categoryWith([catalogEntryNode(20, { noteIds: [101, 102], primaryId: 101 })]),
    ];
    const draft = structuredClone(baseline);
    draft[0].children[0].primary_note_id = 102;

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.updateNodeNotes).toHaveBeenCalledWith(20, {
      note_ids: [101, 102],
      primary_note_id: 102,
    });
  });

  test("an unchanged specimen set calls nothing", async () => {
    const mocks = api();
    const baseline = [
      categoryWith([catalogEntryNode(20, { noteIds: [101, 102], primaryId: 102 })]),
    ];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: structuredClone(baseline),
      api: mocks,
    });

    expect(mocks.updateNodeNotes).not.toHaveBeenCalled();
  });

  test("changed metadata posts an entry update without touching specimens", async () => {
    const mocks = api();
    const baseline = [categoryWith([catalogEntryNode(20, { noteIds: [101] })])];
    const draft = structuredClone(baseline);
    draft[0].children[0].entry.denomination = "100 lei";

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.updateCatalogEntry).toHaveBeenCalledWith(20, {
      catalog_number: "22a",
      denomination: "100 lei",
      issue_date: "1877",
      source: "Pick catalog",
    });
    expect(mocks.updateNodeNotes).not.toHaveBeenCalled();
  });

  test("deleting an entry removes it and leaves the specimen set alone", async () => {
    const mocks = api();
    const baseline = [categoryWith([catalogEntryNode(20, { noteIds: [101] })])];

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: [categoryWith([])],
      api: mocks,
    });

    expect(mocks.deleteNode).toHaveBeenCalledWith(20);
    expect(mocks.updateNodeNotes).not.toHaveBeenCalled();
    expect(mocks.updateCatalogEntry).not.toHaveBeenCalled();
  });

  test("creations replay before specimen updates", async () => {
    const mocks = api();
    const baseline = [categoryWith([catalogEntryNode(20, { noteIds: [101] })])];
    const draft = structuredClone(baseline);
    draft[0].children[0].specimens.push({ id: 102, owned: true });
    draft[0].children.push(
      makeDraftCatalogEntryNode({
        entry: { catalog_number: "22b" },
        parentId: 10,
        specimens: [{ id: 103 }],
      }),
    );

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.createCatalogEntry).toHaveBeenCalledTimes(1);
    expect(mocks.updateNodeNotes).toHaveBeenCalledTimes(1);
    expect(
      mocks.createCatalogEntry.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.updateNodeNotes.mock.invocationCallOrder[0]);
  });

  test("a new entry under a new grouping waits for the grouping's real id", async () => {
    const mocks = api();
    mocks.createShowcaseNode.mockResolvedValueOnce({ node: { id: 900 } });
    const grouping = makeDraftGroupingNode({ name: "1877", parentId: 10 });
    grouping.children.push(
      makeDraftCatalogEntryNode({
        entry: { catalog_number: "22a" },
        parentId: grouping.id,
        specimens: [{ id: 101 }],
      }),
    );

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [categoryWith([])],
      draftNodes: [categoryWith([grouping])],
      api: mocks,
    });

    expect(mocks.createCatalogEntry).toHaveBeenCalledWith(1, {
      parentId: 900,
      entry: {
        catalog_number: "22a",
        denomination: "",
        issue_date: "",
        source: "",
      },
      noteIds: [101],
    });
  });

  test("a new entry with no specimens posts an empty set and no update", async () => {
    const mocks = api();
    const entry = makeDraftCatalogEntryNode({
      entry: { catalog_number: "22a" },
      parentId: 10,
    });

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: [categoryWith([])],
      draftNodes: [categoryWith([entry])],
      api: mocks,
    });

    expect(mocks.createCatalogEntry).toHaveBeenCalledWith(1, {
      parentId: 10,
      entry: {
        catalog_number: "22a",
        denomination: "",
        issue_date: "",
        source: "",
      },
      noteIds: [],
    });
    expect(mocks.updateNodeNotes).not.toHaveBeenCalled();
  });

  test("a stale draft primary never reaches the specimen call", async () => {
    const mocks = api();
    const baseline = [categoryWith([catalogEntryNode(20, { noteIds: [101] })])];
    const draft = structuredClone(baseline);
    draft[0].children[0].specimens.push({ id: 102, owned: true });
    draft[0].children[0].primary_note_id = 999;

    await saveShowcaseDraft({
      showcaseId: 1,
      baselineNodes: baseline,
      draftNodes: draft,
      api: mocks,
    });

    expect(mocks.updateNodeNotes).toHaveBeenCalledWith(20, {
      note_ids: [101, 102],
      primary_note_id: 101,
    });
  });
});
