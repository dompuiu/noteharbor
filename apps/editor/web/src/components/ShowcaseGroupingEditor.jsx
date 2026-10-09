import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseNodeEditor } from "./ShowcaseNodeEditor.jsx";

// Edit-only controls for one Grouping. A Grouping is local to its parent, so a
// rename here never touches another Showcase or Placement. The card and the
// controls come from the shared node editor.
function ShowcaseGroupingEditor({ node, onRemove, onRename, onOpen, children }) {
  return (
    <ShowcaseNodeEditor
      card={<ShowcaseGroupingCard node={node} onOpen={onOpen} />}
      node={node}
      noun="grouping"
      onRemove={onRemove}
      onRename={onRename}
    >
      {children}
    </ShowcaseNodeEditor>
  );
}

export { ShowcaseGroupingEditor };
