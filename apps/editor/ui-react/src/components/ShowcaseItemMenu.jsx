import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { handleMenuNavigation } from "../lib/menuNavigation.js";
import { MenuIcon } from "./MenuIcon.jsx";

// The per-item actions menu that replaces edit mode's icon row. Every card
// owns one; the items only depend on what the item is:
//
// - every item: add a note, a grouping, or a catalog shell after it, remove it
// - catalog entry or catalog-mode note: mark the displayed note owned or not
// - note, or an entry's displayed note: edit the note
// - note: replace it with another library note in place
// - grouping: open, rename, set/clear its cover
// - category: duplicate to another showcase
// - note inside a grouping: make it the grouping's cover
// - anything inside a grouping: move out one level, to its grandparent
// - catalog shell: replace it with a library note, edit its details
//
// The trigger is a quiet `⋯` at the far end of the cell's title bar, opposite
// the drag grip. The panel uses the app's shared anchored popover (portal,
// Escape, outside press, focus return).
function ShowcaseItemMenu({
  label,
  onAddNote,
  onAddGrouping,
  onAddCatalogShell,
  onOpen,
  onRename,
  onSetCover,
  onClearCover,
  onReplaceShell,
  onReplaceNote,
  onEditDetails,
  onEditNote,
  onDuplicate,
  canDuplicate = true,
  onMoveUp,
  onMoveDown,
  onMoveOut,
  onMoveInto,
  canMoveUp = false,
  canMoveDown = false,
  onRemove,
  showCoverActions = false,
  canSetCover = false,
  canClearCover = false,
  isGrouping = false,
  isShell = false,
  isNote = false,
  isCategory = false,
  owned = null,
  onToggleOwned,
}) {
  const actions = [
    owned != null && onToggleOwned
      ? {
          key: "ownership",
          label: owned ? "Mark this note as not owned" : "Mark this note owned",
          icon: owned ? "check-circle" : "circle",
          run: onToggleOwned,
        }
      : null,
    onEditNote
      ? {
          key: "edit-note",
          label: "Edit note…",
          icon: "edit",
          run: onEditNote,
        }
      : null,
    isNote && onReplaceNote
      ? {
          key: "replace-note",
          label: "Replace with a note…",
          icon: "replace",
          run: onReplaceNote,
        }
      : null,
    onAddNote
      ? {
          key: "note",
          label: "Add note after",
          icon: "note-add",
          run: onAddNote,
        }
      : null,
    onAddGrouping
      ? {
          key: "grouping",
          label: "Add grouping after",
          icon: "group-add",
          run: onAddGrouping,
        }
      : null,
    onAddCatalogShell
      ? {
          key: "shell",
          label: "Add placeholder after",
          icon: "shell-add",
          run: onAddCatalogShell,
        }
      : null,
    isGrouping && onOpen
      ? { key: "open", label: "Open grouping", icon: "open", run: onOpen }
      : null,
    isGrouping && onRename
      ? {
          key: "rename",
          label: "Rename grouping…",
          icon: "edit",
          run: onRename,
        }
      : isCategory && onRename
        ? {
            key: "rename",
            label: "Rename category…",
            icon: "edit",
            run: onRename,
          }
        : null,
    isShell && onReplaceShell
      ? {
          key: "replace",
          label: "Replace with a note…",
          icon: "replace",
          run: onReplaceShell,
        }
      : null,
    isShell && onEditDetails
      ? {
          key: "details",
          label: "Edit details…",
          icon: "details",
          run: onEditDetails,
        }
      : null,
    isCategory && onDuplicate
      ? {
          key: "duplicate",
          label: "Duplicate to showcase…",
          icon: "copy",
          run: onDuplicate,
          disabled: !canDuplicate,
        }
      : null,
    onMoveUp
      ? {
          key: "move-up",
          label: "Move up",
          icon: "arrow-up",
          run: onMoveUp,
          disabled: !canMoveUp,
        }
      : null,
    onMoveDown
      ? {
          key: "move-down",
          label: "Move down",
          icon: "arrow-down",
          run: onMoveDown,
          disabled: !canMoveDown,
        }
      : null,
    onMoveOut
      ? {
          key: "move-out",
          label: "Move out one level",
          icon: "source",
          run: onMoveOut,
        }
      : null,
    onMoveInto
      ? {
          key: "move-into",
          label: "Move into…",
          icon: "move",
          run: onMoveInto,
        }
      : null,
    showCoverActions && canSetCover && onSetCover
      ? {
          key: "cover",
          label: "Make this the cover",
          icon: "cover",
          run: onSetCover,
        }
      : null,
    canClearCover && onClearCover
      ? {
          key: "clear-cover",
          label: "Clear the cover",
          icon: "clear-cover",
          run: onClearCover,
        }
      : null,
    onRemove
      ? {
          key: "remove",
          label: isGrouping
            ? "Remove grouping…"
            : isCategory
              ? "Remove category…"
              : "Remove from showcase…",
          icon: "delete",
          run: onRemove,
          danger: true,
        }
      : null,
  ].filter(Boolean);

  return (
    <AnchoredPopover
      align="end"
      className="showcase-item-menu"
      initialFocus={(panel) =>
        panel.querySelector('[role="menuitem"]:not(:disabled)') ?? panel
      }
      onKeyDown={(event, panel) =>
        handleMenuNavigation(event, panel, '[role="menuitem"]')
      }
      panelLabel={`Actions for ${label}`}
      role="menu"
      renderTrigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          aria-label={`Actions for ${label}`}
          className="showcase-item-menu-trigger"
          title="Item actions"
          type="button"
        >
          <svg
            aria-hidden="true"
            focusable="false"
            height="16"
            viewBox="0 0 24 24"
            width="16"
          >
            <circle cx="5" cy="12" fill="currentColor" r="1.6" />
            <circle cx="12" cy="12" fill="currentColor" r="1.6" />
            <circle cx="19" cy="12" fill="currentColor" r="1.6" />
          </svg>
        </button>
      )}
    >
      {({ close }) => (
        <div className="showcase-item-menu-list">
          {actions.map((action) => (
            <button
              className={`showcase-item-menu-item${action.danger ? " showcase-item-menu-item--danger" : ""}`}
              disabled={action.disabled}
              key={action.key}
              onClick={() => {
                close({ returnFocus: true });
                action.run();
              }}
              role="menuitem"
              type="button"
            >
              <MenuIcon name={action.icon} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </AnchoredPopover>
  );
}

export { ShowcaseItemMenu };
