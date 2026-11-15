import {
  catalogEntryCaption,
  catalogEntryIdentity,
  isCatalogEntry,
  nodeCatalogState,
  primarySpecimen,
} from "../lib/showcaseTree.js";
import { normalizePhotoSize } from "../lib/photoSize.js";
import { showcaseNoteDisplayParts, showcaseNoteTitleParts } from "../lib/showcaseNoteLabels.js";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { ShowcaseAddTiles } from "./ShowcaseAddTiles.jsx";
import { ShowcaseCatalogCard } from "./ShowcaseCatalogCard.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseItemMenu } from "./ShowcaseItemMenu.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";

function noteLabel(node) {
  return showcaseNoteDisplayParts(node.note).join(" ") || "note";
}

// The catalog card's visible identity, now carried by the cell's title bar
// instead of a footer under the photo. It reads catalog · date · denomination,
// the same order (and the same small-card `P17` form) as a catalog entry.
function noteCaption(node, { compact = false } = {}) {
  return (
    showcaseNoteTitleParts(node.note, { compact }).join(" · ") || "Untitled note"
  );
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
  // The bar's title has room for `Pick 22a` at Medium and Large; a Small card
  // has about 130px and takes the compact `P22a` instead.
  const compactTitle = normalizePhotoSize(photoSize) === "small";
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
    <ShowcaseGrid size={photoSize}>
      {items.map((node) => {
        if (isCatalogEntry(node)) {
          return (
            <ShowcaseReorderableCell
              key={node.id}
              label={catalogEntryIdentity(node.entry)}
              menu={menuFor(node, { isShell: true })}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
              title={catalogEntryCaption(node.entry, { compact: compactTitle })}
            >
              <ShowcaseCatalogCard
                node={node}
                onOpenFinder={onOpenShell}
                onPresent={onPresent}
                onToggleOwned={onOwnershipToggle}
              />
            </ShowcaseReorderableCell>
          );
        }

        if (node.node_type === "grouping") {
          return (
            <ShowcaseReorderableCell
              key={node.id}
              label={node.name}
              menu={menuFor(node, { isGrouping: true })}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
            >
              <ShowcaseGroupingCard
                node={node}
                onOpen={() => onOpenGrouping(node)}
              />
            </ShowcaseReorderableCell>
          );
        }

        if (node.node_type === "note") {
          return (
            <ShowcaseReorderableCell
              key={node.id}
              label={noteLabel(node)}
              menu={menuFor(node)}
              nodeId={node.id}
              reorder={reorderEnabled ? reorder : null}
              title={catalogMode ? noteCaption(node, { compact: compactTitle }) : null}
            >
              {catalogMode ? (
                <ShowcaseCatalogCard
                  node={node}
                  onOpenNote={onOpenNote}
                  onPresent={onPresent}
                  onToggleOwned={onOwnershipToggle}
                />
              ) : (
                <ShowcaseNoteCard
                  mode="view"
                  nodeId={node.id}
                  note={node.note}
                  onOpen={(kind) => onOpenNote(node, kind)}
                />
              )}
            </ShowcaseReorderableCell>
          );
        }

        return null;
      })}
      <ShowcaseAddTiles onClick={() => onAdd(parent)} />
    </ShowcaseGrid>
  );
}

export { ShowcaseItemsGrid };
