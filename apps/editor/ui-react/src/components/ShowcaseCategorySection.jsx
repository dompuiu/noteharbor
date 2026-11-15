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
    countLabel(entries, "entry", "entries"),
    groupings > 0 ? countLabel(groupings, "grouping", "groupings") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function ShowcaseCategorySection({
  category,
  catalogMode = false,
  photoSize,
  reorderEnabled = true,
  onReorder,
  onAdd,
  onAddNoteAfter,
  onAddGroupingAfter,
  onAddShellAfter,
  onEditShell,
  onOpenGrouping,
  onOpenNote,
  onOpenShell,
  onOwnershipToggle,
  onPresent,
  onRemove,
  onRename,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onSetCover,
  onClearCover,
}) {
  const children = category.children ?? [];

  return (
    <section
      aria-label={`Category ${category.name}`}
      className="showcase-category-section"
    >
      <div className="showcase-category-head">
        <h2 className="showcase-category-title">{category.name}</h2>
        <p className="showcase-category-meta">{categoryMeta(children)}</p>
        <span aria-hidden="true" className="showcase-category-rule" />
        <ShowcaseItemMenu
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          isCategory
          label={category.name}
          onMoveDown={() => onMoveDown?.(category)}
          onMoveUp={() => onMoveUp?.(category)}
          onRemove={() => onRemove(category)}
          onRename={() => onRename(category)}
        />
      </div>

      <ShowcaseItemsGrid
        catalogMode={catalogMode}
        items={children}
        onAdd={onAdd}
        onAddGroupingAfter={onAddGroupingAfter}
        onAddNoteAfter={onAddNoteAfter}
        onAddShellAfter={onAddShellAfter}
        onClearCover={onClearCover}
        onEditShell={onEditShell}
        onOpenGrouping={onOpenGrouping}
        onOpenNote={onOpenNote}
        onOpenShell={onOpenShell}
        onOwnershipToggle={onOwnershipToggle}
        onPresent={onPresent}
        onRemove={onRemove}
        onRenameGrouping={onRename}
        onReorder={onReorder}
        onSetCover={onSetCover}
        parent={category}
        photoSize={photoSize}
        reorderEnabled={reorderEnabled}
      />
    </section>
  );
}

export { ShowcaseCategorySection };
