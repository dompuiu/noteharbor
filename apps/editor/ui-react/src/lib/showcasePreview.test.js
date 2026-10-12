import { describe, expect, test } from "vitest";
import {
  buildShowcasePreviewSearch,
  collectShowcasePreviewNotes,
  findShowcasePreviewIndex,
  getShowcasePreviewContainingLevelId,
  getShowcasePreviewItems,
  parseShowcasePreviewParam,
  showcasePreviewLabel,
} from "./showcasePreview.js";

function note(id, types = ["front"]) {
  return {
    id,
    denomination: `${id}`,
    updated_at: `rev-${id}`,
    images: types.map((type) => ({
      type,
      variant: "full",
      localPath: `/api/images/notes/${id}/${type}.jpg`,
    })),
  };
}

function noteNode(id, theNote, children = []) {
  return {
    id,
    node_type: "note",
    name: null,
    note: theNote,
    children,
  };
}

function grouping(id, children = []) {
  return { id, node_type: "grouping", name: `G${id}`, children };
}

function category(id, children = []) {
  return { id, node_type: "category", name: `C${id}`, children };
}

describe("collectShowcasePreviewNotes", () => {
  test("walks depth-first in display order", () => {
    const nodes = [
      category(10, [
        noteNode(400, note(100)),
        grouping(20, [noteNode(410, note(300))]),
      ]),
      category(11, [noteNode(420, note(200))]),
    ];

    expect(collectShowcasePreviewNotes(nodes).map((e) => e.nodeId)).toEqual([
      400, 410, 420,
    ]);
  });

  test("skips empty groupings and categories", () => {
    const nodes = [
      category(10, [grouping(20, [grouping(21, [])]), noteNode(400, note(1))]),
      category(11, []),
    ];

    expect(collectShowcasePreviewNotes(nodes).map((e) => e.nodeId)).toEqual([
      400,
    ]);
  });
});

describe("getShowcasePreviewItems", () => {
  test("expands front then back and drops imageless notes", () => {
    const both = note(1, ["front", "back"]);
    const frontOnly = note(2, ["front"]);
    const imageless = { id: 3, denomination: "x", images: [] };
    const nodes = [
      category(10, [
        noteNode(400, both),
        noteNode(401, frontOnly),
        noteNode(402, imageless),
      ]),
    ];

    const items = getShowcasePreviewItems(nodes);
    expect(items.map((i) => `${i.nodeId}:${i.kind}`)).toEqual([
      "400:front",
      "400:back",
      "401:front",
    ]);
    // Every item carries its note for the popover label, including backs.
    expect(items.map((i) => i.note?.id)).toEqual([1, 1, 2]);
    expect(showcasePreviewLabel(items[1].note, items[1].kind)).toBe(
      "1 - Back",
    );
  });

  test("prefers the full image over the thumbnail", () => {
    const n = {
      id: 1,
      denomination: "1",
      updated_at: "r",
      images: [
        { type: "front", variant: "thumbnail", localPath: "/t.jpg" },
        { type: "front", variant: "full", localPath: "/f.jpg" },
      ],
    };
    const items = getShowcasePreviewItems([noteNode(400, n)]);
    expect(items[0].src).toContain("/f.jpg");
  });
});

describe("findShowcasePreviewIndex", () => {
  test("finds the exact face and falls back to the node's first item", () => {
    const items = getShowcasePreviewItems([
      noteNode(400, note(1, ["back"])),
    ]);
    expect(findShowcasePreviewIndex(items, 400, "back")).toBe(0);
    expect(findShowcasePreviewIndex(items, 400, "front")).toBe(0);
    expect(findShowcasePreviewIndex(items, 999, "front")).toBe(-1);
  });
});

describe("preview param", () => {
  test("parses and builds the search string", () => {
    expect(parseShowcasePreviewParam("410:back")).toEqual({
      kind: "back",
      nodeId: 410,
    });
    expect(parseShowcasePreviewParam("410:side")).toBeNull();
    expect(parseShowcasePreviewParam(null)).toBeNull();
    expect(
      buildShowcasePreviewSearch({ node: "20", previewNodeId: 410, previewKind: "front" }),
    ).toBe("?node=20&preview=410%3Afront");
    expect(
      buildShowcasePreviewSearch({ node: null, previewNodeId: 410, previewKind: "front" }),
    ).toBe("?preview=410%3Afront");
  });
});

describe("containing level", () => {
  test("returns the deepest grouping ancestor or null at root", () => {
    const nodes = [
      category(10, [
        noteNode(400, note(1)),
        grouping(20, [grouping(21, [noteNode(410, note(2))])]),
      ]),
    ];
    expect(getShowcasePreviewContainingLevelId(nodes, 410)).toBe(21);
    expect(getShowcasePreviewContainingLevelId(nodes, 400)).toBeNull();
    expect(getShowcasePreviewContainingLevelId(nodes, 999)).toBeNull();
  });
});

describe("showcasePreviewLabel", () => {
  test("joins display parts with the face", () => {
    expect(
      showcasePreviewLabel(
        { denomination: "1 leu", catalog_number: "17", issue_date: "1917" },
        "back",
      ),
    ).toBe("1 leu, Pick 17, 1917 - Back");
  });
});
