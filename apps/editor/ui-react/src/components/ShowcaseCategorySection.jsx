import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseAddTiles } from "./ShowcaseAddTiles.jsx";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";
import { ShowcaseCatalogCell } from "./ShowcaseCatalogCell.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNodeEditor } from "./ShowcaseNodeEditor.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import {
  categoryCardCount,
  isCatalogEntry,
  visibleChildNodes,
} from "../lib/showcaseTree.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";

// One top-level Category rendered always expanded: a section header plus the
// inline grid of its direct children. Groupings inside still drill (they nest);
// only the Category level is expanded, so a Category never needs an `onOpen`.
function noteNodeLabel(node) {
  const note = node.note ?? {};
  return (
    showcaseNoteDisplayParts(note).join(" ") || "note"
  );
}

function ShowcaseCategorySection({
  category,
  catalogMode = false,
  editMode,
  photoSize,
  onAddCatalogEntry,
  onAddGrouping,
  onAddNotes,
  onEditCatalogEntry,
  onOpenFinder,
  onOpenGrouping,
  onOpenManager,
  onOpenNote,
  onOwnershipToggle,
  onPresent,
  onRemoveCatalogEntry,
  onRemoveGrouping,
  onRemoveNote,
  onRemoveCategory,
  onRenameCategory,
  onRenameGrouping,
  onReorder,
  onMoveCategory,
  canMoveUp = false,
  canMoveDown = false,
}) {
  const children = category.children ?? [];
  const visibleChildren = visibleChildNodes(children, editMode);
  const reorder = useShowcaseReorder({
    nodes: children,
    onReorder: (orderedIds) => onReorder(category.id, orderedIds),
  });

  // View mode never presents an empty Category: no cards anywhere beneath it
  // means no section at all. In a catalog a position with no specimens is a
  // card, so the entry count keeps the section. Edit mode keeps it so it can be
  // filled.
  const contentCount = categoryCardCount(category, catalogMode);

  if (!editMode && contentCount === 0) {
    return null;
  }

  return (
    <section
      aria-label={`Category ${category.name}`}
      className="showcase-category-section"
    >
      {editMode ? (
        <ShowcaseNodeEditor
          card={
            <h2
              className="showcase-category-title showcase-category-focus"
              data-showcase-node-id={category.id}
              tabIndex={0}
            >
              {category.name}
            </h2>
          }
          node={category}
          noun="category"
          onRemove={onRemoveCategory}
          onRename={onRenameCategory}
          onMoveUp={onMoveCategory ? () => onMoveCategory(category, -1) : undefined}
          onMoveDown={onMoveCategory ? () => onMoveCategory(category, 1) : undefined}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
        />
      ) : (
        <h2 className="showcase-category-title">{category.name}</h2>
      )}

      {children.length > 0 ? (
        <ShowcaseGrid size={photoSize}>
          {visibleChildren.map((node) => {
            if (
              catalogMode &&
              !editMode &&
              node.node_type === "note"
            ) {
              return (
                <ShowcaseCatalogCard
                  key={node.id}
                  node={node}
                  onOpenFinder={onOpenFinder}
                  onOpenManager={onOpenManager}
                  onOpenNote={onOpenNote}
                  onPresent={onPresent}
                  onToggleOwned={onOwnershipToggle}
                />
              );
            }

            if (isCatalogEntry(node)) {
              return (
                <ShowcaseCatalogCell
                  editMode={editMode}
                  key={node.id}
                  node={node}
                  onEditDetails={onEditCatalogEntry}
                  onOpenFinder={onOpenFinder}
                  onOpenManager={onOpenManager}
                  onOpenNote={onOpenNote}
                  onPresent={onPresent}
                  onRemove={onRemoveCatalogEntry}
                  onToggleOwned={onOwnershipToggle}
                  reorder={reorder}
                />
              );
            }

            if (node.node_type === "grouping") {
              return editMode ? (
                <ShowcaseReorderableCell
                  key={node.id}
                  label={node.name}
                  nodeId={node.id}
                  reorder={reorder}
                >
                  <ShowcaseGroupingEditor
                    node={node}
                    onOpen={() => onOpenGrouping(node)}
                    onRemove={onRemoveGrouping}
                    onRename={onRenameGrouping}
                    photoSize={photoSize}
                  />
                </ShowcaseReorderableCell>
              ) : (
                <ShowcaseGroupingCard
                  key={node.id}
                  node={node}
                  onOpen={() => onOpenGrouping(node)}
                />
              );
            }

            if (node.node_type === "note") {
              return editMode ? (
                <ShowcaseReorderableCell
                  key={node.id}
                  label={noteNodeLabel(node)}
                  nodeId={node.id}
                  reorder={reorder}
                >
                  <ShowcaseNoteEditor node={node} onRemove={onRemoveNote} />
                </ShowcaseReorderableCell>
              ) : (
                <ShowcaseNoteCard
                  key={node.id}
                  mode="view"
                  nodeId={node.id}
                  note={node.note}
                  onOpen={(kind) => onOpenNote?.(node, kind)}
                />
              );
            }

            return null;
          })}

          {editMode ? (
            <ShowcaseAddTiles
              catalogParentId={category.id}
              onAddCatalogEntry={() => onAddCatalogEntry(category)}
              onAddGrouping={(name) => onAddGrouping(category.id, name)}
              onAddNotes={() => onAddNotes(category)}
            />
          ) : null}
        </ShowcaseGrid>
      ) : editMode ? (
        <ShowcaseGrid size={photoSize}>
          <ShowcaseAddTiles
            catalogParentId={category.id}
            onAddCatalogEntry={() => onAddCatalogEntry(category)}
            onAddGrouping={(name) => onAddGrouping(category.id, name)}
            onAddNotes={() => onAddNotes(category)}
          />
        </ShowcaseGrid>
      ) : null}
    </section>
  );
}

export { ShowcaseCategorySection };
