import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseAddTiles } from "./ShowcaseAddTiles.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNodeEditor } from "./ShowcaseNodeEditor.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { countNoteNodes } from "../lib/showcaseTree.js";

// One top-level Category rendered always expanded: a section header plus the
// inline grid of its direct children. Groupings inside still drill (they nest);
// only the Category level is expanded, so a Category never needs an `onOpen`.
function noteNodeLabel(node) {
  const note = node.note ?? {};
  return (
    [note.denomination, note.issue_date].filter(Boolean).join(" ") || "note"
  );
}

function ShowcaseCategorySection({
  category,
  editMode,
  photoSize,
  onAddGrouping,
  onAddNotes,
  onOpenGrouping,
  onRemoveGrouping,
  onRemoveNote,
  onRemoveCategory,
  onRenameCategory,
  onRenameGrouping,
  onReorder,
}) {
  const children = category.children ?? [];
  const reorder = useShowcaseReorder({
    nodes: children,
    onReorder: (orderedIds) => onReorder(category.id, orderedIds),
  });

  // View mode never presents an empty Category: no notes anywhere beneath it
  // means no section at all. Edit mode keeps it so it can be filled.
  if (!editMode && countNoteNodes(children) === 0) {
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
            <h2 className="showcase-category-title">{category.name}</h2>
          }
          node={category}
          noun="category"
          onRemove={onRemoveCategory}
          onRename={onRenameCategory}
        />
      ) : (
        <h2 className="showcase-category-title">{category.name}</h2>
      )}

      {children.length > 0 ? (
        <ShowcaseGrid size={photoSize}>
          {children.map((node) => {
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
                />
              );
            }

            return null;
          })}

          {editMode ? (
            <ShowcaseAddTiles
              onAddGrouping={(name) => onAddGrouping(category.id, name)}
              onAddNotes={() => onAddNotes(category)}
            />
          ) : null}
        </ShowcaseGrid>
      ) : editMode ? (
        <ShowcaseGrid size={photoSize}>
          <ShowcaseAddTiles
            onAddGrouping={(name) => onAddGrouping(category.id, name)}
            onAddNotes={() => onAddNotes(category)}
          />
        </ShowcaseGrid>
      ) : null}
    </section>
  );
}

export { ShowcaseCategorySection };
