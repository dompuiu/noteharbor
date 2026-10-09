import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNoteTile } from "./ShowcaseNoteTile.jsx";

// The edit-mode contents of one node: its child note cards, then the note-sized
// `+ notes` tile in the same grid. Groupings are ticket 09's to render here.
function ShowcaseNodeItems({ node, onAddNotes, onRemoveNote }) {
  const notes = (node.children ?? []).filter(
    (child) => child.node_type === "note",
  );

  return (
    <ShowcaseGrid className="showcase-node-items">
      {notes.map((noteNode) => (
        <ShowcaseNoteEditor key={noteNode.id} node={noteNode} onRemove={onRemoveNote} />
      ))}
      <ShowcaseNoteTile onClick={() => onAddNotes(node)} />
    </ShowcaseGrid>
  );
}

export { ShowcaseNodeItems };
