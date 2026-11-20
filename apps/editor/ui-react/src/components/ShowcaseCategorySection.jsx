import { ShowcaseItemMenu } from "./ShowcaseItemMenu.jsx";
import { ShowcaseItemsGrid } from "./ShowcaseItemsGrid.jsx";

// One top-level Category rendered always expanded: a section header plus the
// inline grid of its direct children. Groupings inside still drill (they nest);
// only the Category level is expanded, so a Category never needs an `onOpen`.
function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function categoryMeta(children) {
  const groupings = children.filter(
    (node) => node.node_type === "grouping",
  ).length;
  const entries = children.length - groupings;
  return [
    entries > 0 ? countLabel(entries, "entry", "entries") : "",
    groupings > 0 ? countLabel(groupings, "grouping", "groupings") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function ShowcaseCategorySection({
  category,
  catalogLayout = "labels",
  photoSize,
  reorderEnabled = true,
  onReorder,
  onMove,
  onMoveOut,
  onMoveInto,
  onDragState,
  onAdd,
  onAddNoteAfter,
  onAddGroupingAfter,
  onAddShellAfter,
  onEditShell,
  onEditNote,
  onReplaceNote,
  onOpenGrouping,
  onOpenNote,
  onOpenShell,
  onOwnershipToggle,
  onPresent,
  onRemove,
  onRename,
  onDuplicate,
  canDuplicate = false,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onSetCover,
  onClearCover,
}) {
  const children = category.children ?? [];
  const meta = categoryMeta(children);

  return (
    <section
      aria-label={`Category ${category.name}`}
      className="showcase-category-section"
    >
      <div className="showcase-category-head">
        <h2 className="showcase-category-title">{category.name}</h2>
        {meta ? <p className="showcase-category-meta">{meta}</p> : null}
        <span aria-hidden="true" className="showcase-category-rule" />
        <ShowcaseItemMenu
          canDuplicate={canDuplicate}
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          isCategory
          label={category.name}
          onDuplicate={() => onDuplicate(category)}
          onMoveDown={() => onMoveDown?.(category)}
          onMoveUp={() => onMoveUp?.(category)}
          onRemove={() => onRemove(category)}
          onRename={() => onRename(category)}
        />
      </div>

      <ShowcaseItemsGrid
        canDuplicate={canDuplicate}
        catalogLayout={catalogLayout}
        items={children}
        onAdd={onAdd}
        onAddGroupingAfter={onAddGroupingAfter}
        onAddNoteAfter={onAddNoteAfter}
        onAddShellAfter={onAddShellAfter}
        onClearCover={onClearCover}
        onEditShell={onEditShell}
        onEditNote={onEditNote}
        onDuplicate={onDuplicate}
        onReplaceNote={onReplaceNote}
        onOpenGrouping={onOpenGrouping}
        onOpenNote={onOpenNote}
        onOpenShell={onOpenShell}
        onOwnershipToggle={onOwnershipToggle}
        onPresent={onPresent}
        onRemove={onRemove}
        onRenameGrouping={onRename}
        onReorder={onReorder}
        onMove={onMove}
        onMoveOut={onMoveOut}
        onMoveInto={onMoveInto}
        onDragState={onDragState}
        onSetCover={onSetCover}
        parent={category}
        photoSize={photoSize}
        reorderEnabled={reorderEnabled}
      />
    </section>
  );
}

export { ShowcaseCategorySection };
