import {
  catalogEntryIdentity,
  isCatalogEntry,
  nodeCatalogState,
  primarySpecimen,
} from "../lib/showcaseTree.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { ShowcaseAddCard } from "./ShowcaseAddCard.jsx";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseItemMenu } from "./ShowcaseItemMenu.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";

function noteLabel(node) {
  return showcaseNoteDisplayParts(node.note).join(" ") || "note";
}

// One level's cards in the always-editable canvas. Every item is draggable and
// carries the same actions menu; the card body keeps its own presentation
// interaction (open, preview, ownership). A Category level renders this same
// grid under its header, so the drilled Grouping level and every Category
// section never drift.
function ShowcaseItemsGrid({
  parent,
  items,
  catalogMode,
  catalogLayout = "labels",
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
  onRenameGrouping,
  onSetCover,
  onClearCover,
}) {
  const reorder = useShowcaseReorder({
    nodes: items,
    onReorder: (orderedIds) => onReorder(parent?.id ?? null, orderedIds),
  });
  const isGroupingParent = parent?.node_type === "grouping";

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
    const label = isGrouping
      ? node.name
      : isShell
        ? catalogEntryIdentity(node.entry)
        : node.node_type === "note"
          ? noteLabel(node)
          : node.name;
    const ownershipNote = isCatalogEntry(node)
      ? primarySpecimen(node)
      : catalogMode
        ? node.note
        : null;
    const catalogState =
      ownershipNote != null && (isCatalogEntry(node) || catalogMode)
        ? nodeCatalogState(node)
        : null;

    return (
      <ShowcaseItemMenu
        canClearCover={isGrouping && node.cover_note_id != null}
        canSetCover={isGroupingParent}
        isGrouping={isGrouping}
        isShell={isShell}
        label={label || "item"}
        onAddCatalogShell={() => onAddShellAfter(parent, node)}
        onAddGrouping={() => onAddGroupingAfter(parent, node)}
        onAddNote={() => onAddNoteAfter(parent, node)}
        onClearCover={() => onClearCover(node)}
        canMoveDown={index >= 0 && index < items.length - 1}
        canMoveUp={index > 0}
        onEditDetails={() => onEditShell(node)}
        onMoveDown={
          reorderEnabled ? () => moveNode(node, 1) : undefined
        }
        onMoveUp={
          reorderEnabled ? () => moveNode(node, -1) : undefined
        }
        onOpen={() => onOpenGrouping(node)}
        onRemove={() => onRemove(node)}
        onRename={() => onRenameGrouping(node)}
        onReplaceShell={() => onOpenShell(node)}
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
    <ShowcaseGrid
      catalogLayout={catalogMode ? catalogLayout : null}
      size={photoSize}
    >
      {items.map((node) => {
        if (isCatalogEntry(node)) {
          return (
            <ShowcaseReorderableCell
              embedded
              key={node.id}
              label={catalogEntryIdentity(node.entry)}
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
              reorder={reorderEnabled ? reorder : null}
            >
              {({ grip, menu }) => (
                <ShowcaseGroupingCard
                  grip={grip}
                  layout={catalogMode ? catalogLayout : "labels"}
                  menu={menu}
                  node={node}
                  onOpen={() => onOpenGrouping(node)}
                />
              )}
            </ShowcaseReorderableCell>
          );
        }

        if (node.node_type === "note") {
          if (catalogMode) {
            return (
              <ShowcaseReorderableCell
                embedded
                key={node.id}
                label={noteLabel(node)}
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

          return (
            <ShowcaseReorderableCell
              key={node.id}
              label={noteLabel(node)}
              menu={menuFor(node)}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
            >
              <ShowcaseNoteCard
                mode="view"
                nodeId={node.id}
                note={node.note}
                onOpen={(kind) => onOpenNote(node, kind)}
              />
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
