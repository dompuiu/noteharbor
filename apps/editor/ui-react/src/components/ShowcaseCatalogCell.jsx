import { catalogEntryIdentity } from "../lib/showcaseTree.js";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";
import { ShowcaseCatalogEditor } from "./ShowcaseCatalogEditor.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";

// One Catalog entry in a grid. Both the expanded Category sections and a
// drilled Grouping render entries through this seam so the checklist card and
// the edit-mode editor can never drift: edit mode wraps the editor in the
// draggable cell, view mode paints the checklist card.
function ShowcaseCatalogCell({
  editMode,
  node,
  onEditDetails,
  onOpenFinder,
  onOpenManager,
  onOpenNote,
  onPresent,
  onRemove,
  onToggleOwned,
  reorder,
}) {
  if (editMode) {
    return (
      <ShowcaseReorderableCell
        label={catalogEntryIdentity(node.entry)}
        nodeId={node.id}
        reorder={reorder}
      >
        <ShowcaseCatalogEditor
          node={node}
          onEditDetails={onEditDetails}
          onManageNotes={onOpenManager}
          onRemove={onRemove}
        />
      </ShowcaseReorderableCell>
    );
  }

  return (
    <ShowcaseCatalogCard
      node={node}
      onOpenFinder={onOpenFinder}
      onOpenManager={onOpenManager}
      onOpenNote={onOpenNote}
      onPresent={onPresent}
      onToggleOwned={onToggleOwned}
    />
  );
}

export { ShowcaseCatalogCell };
