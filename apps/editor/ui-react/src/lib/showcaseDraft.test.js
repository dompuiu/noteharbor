import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  isTempId,
  makeDraftCategoryNode,
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
    updateNode: vi.fn(async () => ({ node: {} })),
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
