import { ShowcaseCategoryCard } from "./ShowcaseCategoryCard.jsx";
import { ShowcaseNodeEditor } from "./ShowcaseNodeEditor.jsx";

// Edit-only controls for one Category Placement. Renaming the Placement renames
// the shared label server-side, so every Showcase that places it shows the new
// name. The card and the controls come from the shared node editor.
function ShowcaseCategoryEditor({ node, onRemove, onRename, onOpen, children }) {
  return (
    <ShowcaseNodeEditor
      card={<ShowcaseCategoryCard name={node.name} nodeId={node.id} onOpen={onOpen} />}
      node={node}
      noun="category"
      onRemove={onRemove}
      onRename={onRename}
    >
      {children}
    </ShowcaseNodeEditor>
  );
}

export { ShowcaseCategoryEditor };
