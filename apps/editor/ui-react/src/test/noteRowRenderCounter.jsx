import { memo } from "react";

// Counts how many note rows actually rendered during an interaction. A row
// renders when React calls its component body, which the memo boundary makes
// a proxy for "this row's props changed"; a parent commit that leaves every
// row's props alone leaves this at zero.
//
// The test file wraps the real row in a memoized tracker, so the tracker's
// own shallow comparison decides when to count:
//
//   vi.mock("./NoteRow.jsx", async (importOriginal) => {
//     const actual = await importOriginal();
//     const { trackNoteRows } = await import("../test/noteRowRenderCounter.jsx");
//     return { NoteRow: trackNoteRows(actual.NoteRow) };
//   });
export const noteRowRenders = { count: 0, ids: [] };

export function resetNoteRowRenders() {
  noteRowRenders.count = 0;
  noteRowRenders.ids = [];
}

export function noteRowRenderCount() {
  return noteRowRenders.count;
}

export function trackNoteRows(NoteRowComponent) {
  // The wrapper is memoized the same way the real row is, so it is called only
  // when that row's props change rather than on every parent render.
  return memo(function TrackedNoteRow(props) {
    noteRowRenders.count += 1;
    noteRowRenders.ids.push(props.note.id);
    return <NoteRowComponent {...props} />;
  });
}
