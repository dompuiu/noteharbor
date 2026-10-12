import { describe, expect, test } from "vitest";
import { resolveGroupingCover } from "./showcaseCovers.js";

function note(id) {
  return { id, denomination: String(id), issue_date: "2020" };
}

function noteNode(id, noteId) {
  return { id, node_type: "note", note: note(noteId), children: [] };
}

function grouping(id, children = [], extra = {}) {
  return {
    id,
    node_type: "grouping",
    name: `Group ${id}`,
    cover_note: null,
    children,
    ...extra,
  };
}

describe("resolveGroupingCover", () => {
  test("returns null when the grouping has no notes beneath it", () => {
    expect(resolveGroupingCover(grouping(1))).toBeNull();
  });

  test("returns the first own note", () => {
    const node = grouping(1, [noteNode(2, 100), noteNode(3, 200)]);

    expect(resolveGroupingCover(node)).toEqual(note(100));
  });

  test("descends depth-first in manual order", () => {
    const node = grouping(1, [
      grouping(2, [noteNode(20, 100)]),
      noteNode(3, 200),
    ]);

    expect(resolveGroupingCover(node)).toEqual(note(100));
  });

  test("recurses past an empty grouping to the next note", () => {
    const node = grouping(1, [
      grouping(2),
      grouping(3, [noteNode(30, 300)]),
    ]);

    expect(resolveGroupingCover(node)).toEqual(note(300));
  });

  test("the manual cover wins over the derived note", () => {
    const node = grouping(1, [noteNode(2, 100)], {
      cover_note: note(999),
      cover_note_id: 999,
    });

    expect(resolveGroupingCover(node)).toEqual(note(999));
  });

  test("clearing the manual cover returns to the derived note", () => {
    const node = grouping(1, [noteNode(2, 100)], { cover_note: null });

    expect(resolveGroupingCover(node)).toEqual(note(100));
  });
});
