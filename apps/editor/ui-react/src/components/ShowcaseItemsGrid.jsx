import {
  isCatalogEntry,
  isNoteNode,
  nodeCatalogState,
  primarySpecimen,
  showcaseNodeLabel,
} from "../lib/showcaseTree.js";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { ShowcaseAddCard } from "./ShowcaseAddCard.jsx";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseItemMenu } from "./ShowcaseItemMenu.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { ShowcaseSpringDrawer } from "./ShowcaseSpringDrawer.jsx";

function isContainer(node) {
  return node?.node_type === "grouping";
}

// One level's cards in the always-editable canvas. Every item is draggable and
// carries the same actions menu; the card body keeps its own presentation
// interaction (open, preview, ownership). A Category level renders this same
// grid under its header, so the drilled Grouping level and every Category
// section never drift.
function ShowcaseItemsGrid({
  parent,
  items,
  catalogLayout = "labels",
  photoSize,
  reorderEnabled = true,
  onReorder,
  onMove,
  onMoveOut,
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
  onRenameGrouping,
  onSetCover,
  onClearCover,
  onMoveInto,
}) {
  const reorder = useShowcaseReorder({
    nodes: items,
    onDragState,
    onReorder: (orderedIds) => onReorder(parent?.id ?? null, orderedIds),
    onMove,
  });
  const isGroupingParent = parent?.node_type === "grouping";

  function drawerFor(node) {
    if (!isContainer(node) || reorder.drawerId !== node.id) {
      return null;
    }

    return (
      <ShowcaseSpringDrawer
        drawerTarget={reorder.drawerTarget}
        draggedId={reorder.draggedId}
        items={node.children ?? []}
        label={node.name}
        onDragOverSurface={reorder.handleDrawerSurfaceDragOver}
        onDragOverInto={reorder.handleDrawerIntoDragOver}
        onDragOverRow={reorder.handleDrawerDragOver}
        onDropSurface={reorder.handleDrawerSurfaceDrop}
        onDropInto={reorder.handleDrawerIntoDrop}
        onDropRow={reorder.handleDrawerDrop}
        parentId={node.id}
      />
    );
  }

  function moveNode(node, direction) {
    const ids = items.map((entry) => entry.id);
    const index = ids.indexOf(node.id);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
      return;
    }

    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    onReorder(parent?.id ?? null, ids);
  }

  function menuFor(node, { isGrouping = false, isShell = false } = {}) {
    const index = items.findIndex((entry) => entry.id === node.id);
    const label = showcaseNodeLabel(node);
    const ownershipNote = isCatalogEntry(node)
      ? primarySpecimen(node)
      : node.node_type === "note"
        ? node.note
        : null;
    const catalogState =
      ownershipNote != null ? nodeCatalogState(node) : null;
    const displayedNote = isCatalogEntry(node)
      ? primarySpecimen(node)
      : node.node_type === "note"
        ? node.note
        : null;

    return (
      <ShowcaseItemMenu
        canClearCover={isGrouping && node.cover_note_id != null}
        canSetCover={isGroupingParent}
        isGrouping={isGrouping}
        isNote={isNoteNode(node)}
        isShell={isShell}
        label={label || "item"}
        onAddCatalogShell={() => onAddShellAfter(parent, node)}
        onAddGrouping={() => onAddGroupingAfter(parent, node)}
        onAddNote={() => onAddNoteAfter(parent, node)}
        onClearCover={() => onClearCover(node)}
        canMoveDown={index >= 0 && index < items.length - 1}
        canMoveUp={index > 0}
        onEditDetails={() => onEditShell(node)}
        onEditNote={
          displayedNote && onEditNote
            ? () => onEditNote(displayedNote, node.id)
            : undefined
        }
        onMoveDown={
          reorderEnabled ? () => moveNode(node, 1) : undefined
        }
        onMoveOut={
          reorderEnabled && isGroupingParent && onMoveOut
            ? () => onMoveOut(node)
            : undefined
        }
        onMoveUp={
          reorderEnabled ? () => moveNode(node, -1) : undefined
        }
        onMoveInto={reorderEnabled && onMoveInto ? () => onMoveInto(node) : undefined}
        onOpen={() => onOpenGrouping(node)}
        onRemove={() => onRemove(node)}
        onRename={() => onRenameGrouping(node)}
        onReplaceShell={() => onOpenShell(node)}
        onReplaceNote={
          onReplaceNote ? () => onReplaceNote(node) : undefined
        }
        onSetCover={() => onSetCover(node)}
        onToggleOwned={
          catalogState
            ? () =>
                onOwnershipToggle?.(
                  ownershipNote,
                  catalogState !== "owned",
                  node.id,
                )
            : undefined
        }
        owned={
          catalogState === "owned"
            ? true
            : catalogState === "seen"
              ? false
              : null
        }
        showCoverActions={!isGrouping && isGroupingParent}
      />
    );
  }

  return (
    <ShowcaseGrid catalogLayout={catalogLayout} size={photoSize}>
      {items.map((node) => {
        if (isCatalogEntry(node)) {
          return (
            <ShowcaseReorderableCell
              embedded
              key={node.id}
              label={showcaseNodeLabel(node)}
              menu={menuFor(node, { isShell: true })}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
            >
              {({ grip, menu }) => (
                <ShowcaseCatalogCard
                  grip={grip}
                  layout={catalogLayout}
                  menu={menu}
                  node={node}
                  onOpenFinder={onOpenShell}
                  onPresent={onPresent}
                  onToggleOwned={onOwnershipToggle}
                />
              )}
            </ShowcaseReorderableCell>
          );
        }

        if (node.node_type === "grouping") {
          return (
            <ShowcaseReorderableCell
              embedded
              key={node.id}
              label={node.name}
              menu={menuFor(node, { isGrouping: true })}
              nodeId={node.id}
              container
              drawer={reorderEnabled ? drawerFor(node) : null}
              reorder={reorderEnabled ? reorder : null}
              springing={reorderEnabled && reorder.springId === node.id}
              targetChildren={node.children ?? []}
            >
              {({ grip, menu }) => (
                <ShowcaseGroupingCard
                  grip={grip}
                  layout={catalogLayout}
                  menu={menu}
                  node={node}
                  onOpen={() => onOpenGrouping(node)}
                  springing={reorderEnabled && reorder.springId === node.id}
                />
              )}
            </ShowcaseReorderableCell>
          );
        }

        if (node.node_type === "note") {
          return (
            <ShowcaseReorderableCell
              embedded
              key={node.id}
              label={showcaseNodeLabel(node)}
              menu={menuFor(node)}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
            >
              {({ grip, menu }) => (
                <ShowcaseCatalogCard
                  grip={grip}
                  layout={catalogLayout}
                  menu={menu}
                  node={node}
                  onOpenNote={onOpenNote}
                  onPresent={onPresent}
                  onToggleOwned={onOwnershipToggle}
                />
              )}
            </ShowcaseReorderableCell>
          );
        }

        return null;
      })}
      <ShowcaseAddCard onAdd={() => onAdd(parent)} />
    </ShowcaseGrid>
  );
}

export { ShowcaseItemsGrid };
