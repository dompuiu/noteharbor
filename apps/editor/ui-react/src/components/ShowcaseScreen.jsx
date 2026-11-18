import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createCatalogEntry,
  createShowcaseNode,
  deleteCategory,
  deleteNode,
  duplicateNode,
  getCategories,
  getShowcaseTree,
  moveNode,
  reorderNodes,
  replaceCatalogEntryWithNote,
  updateCatalogEntry,
  updateNode,
  updateNote,
} from "../lib/api.js";
import { isEditableElement } from "../lib/editableElement.js";
import {
  neighbouringImageSources,
  useImagePreload,
} from "../lib/imagePreload.js";
import { usePhotoSize } from "../lib/photoSize.js";
import { useCatalogLayout } from "../lib/catalogLayout.js";
import {
  showcaseNoteDisplayParts,
  showcaseNoteTitleParts,
} from "../lib/showcaseNoteLabels.js";
import {
  DEFAULT_DESTINATION,
  noteEditorHash,
  parseNoteEditorHash,
  SHOWCASE_ROUTES,
  showcaseNodeSearch,
} from "../lib/routes.js";
import {
  appendChildren,
  appendPositionFor,
  catalogCounts,
  catalogEntryIdentity,
  catalogPresentationNotes,
  filterCatalogTree,
  findNodeById,
  findNodeIdForNote,
  findNodeIdPath,
  findNodePath,
  findParentId,
  isCatalogEntry,
  isNoteNode,
  moveNodeTree,
  noteOwnedInTree,
  removeNodeTree,
  reorderNodeTree,
  setNoteOwned,
  showcaseNodeLabel,
  updateNodeTree,
} from "../lib/showcaseTree.js";
import {
  buildShowcasePreviewSearch,
  findShowcasePreviewIndex,
  getShowcasePreviewContainingLevelId,
  getShowcasePreviewItems,
  parseShowcasePreviewParam,
} from "../lib/showcasePreview.js";
import { useShowcases } from "../lib/showcases.jsx";
import { useCollections } from "../lib/collections.jsx";
import { ActionsMenu } from "./ActionsMenu.jsx";
import { ShowcaseCategorySection } from "./ShowcaseCategorySection.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseAddDialog } from "./ShowcaseAddDialog.jsx";
import { ShowcaseBreadcrumb } from "./ShowcaseBreadcrumb.jsx";
import { ShowcaseCatalogShellForm } from "./ShowcaseCatalogShellForm.jsx";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";
import { ShowcaseDuplicateDialog } from "./ShowcaseDuplicateDialog.jsx";
import { ShowcaseItemsGrid } from "./ShowcaseItemsGrid.jsx";
import { ShowcaseNameDialog } from "./ShowcaseNameDialog.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { ShowcaseMoveDialog } from "./ShowcaseMoveDialog.jsx";
import { ShowcaseLayoutControl } from "./ShowcaseLayoutControl.jsx";
import { ShowcasePhotoSizeControl } from "./ShowcasePhotoSizeControl.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { ImagePopover, Slideshow } from "./Slideshow.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { useToastHost } from "./Toast.jsx";

// One showcase, one always-editable canvas. Adds, renames, removals, and drag
// reorders write immediately (with a toast when a write fails); there is no
// draft, Save, Cancel, or separate edit route. A Catalog shell is a planned
// card: it carries metadata only and becomes a real note in place when the
// collector picks one.

// The drag handle's accessible name for a note node.
function noteNodeLabel(node) {
  const note = node.note ?? {};
  return showcaseNoteDisplayParts(note).join(" ") || "note";
}

// Focus a control inside the showcase canvas on the next frame. Closers and
// state flips remount the trigger, so the lookup waits for the committed DOM.
function focusShowcaseControl(sectionRef, selector) {
  requestAnimationFrame(() => {
    sectionRef.current?.querySelector(selector)?.focus?.();
  });
}

// A Showcase URL carries two independent parts that must survive each other:
// the `?node=` / `?preview=` search and the Note editor's `#edit/<noteId>`
// hash. A partial `navigate({ search })` drops the hash, so both are always
// named together.
function showcaseLocation(location, { search, hash } = {}) {
  return {
    pathname: location.pathname,
    search: search ?? location.search,
    hash: hash ?? location.hash,
  };
}

// One selector for the canvas's focusable card stops: real cards plus the
// ghost add cards at each level. Keeping it in one place stops the keyboard
// walk and the click target from drifting apart.
const SHOWCASE_CARD_SELECTOR = ".showcase-card, .showcase-ghost-add";

const CARD_FILTERS = [
  { value: "all", label: "All" },
  {
    value: "owned",
    label: "Owned",
    emptyText: "Mark a seen card owned to see it here.",
    emptyTitle: "No owned cards.",
  },
  {
    value: "seen",
    label: "Seen",
    emptyText: "Every card here is owned or unseen.",
    emptyTitle: "No seen cards.",
  },
  {
    value: "unseen",
    label: "Unseen",
    emptyText: "No unseen cards here.",
    emptyTitle: "No unseen cards.",
  },
];

function ShowcaseScreen() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    showcases,
    deleteShowcase,
    renameShowcase,
    refreshShowcases,
  } = useShowcases();
  const { collections } = useCollections();
  const toastHost = useToastHost();
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();
  const showcaseId = Number(id);
  const showcase = showcases.find((entry) => entry.id === showcaseId) ?? null;
  const showcaseName = showcase?.name ?? "Showcase";
  const sectionRef = useRef(null);

  const [nameDraft, setNameDraft] = useState(showcaseName);
  const [nameError, setNameError] = useState("");
  // The title becomes a field while renaming, matching the collection table
  // header: Rename in the actions menu opens it, Save/Cancel close it.
  const [renamingName, setRenamingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const nameFieldRef = useRef(null);
  const nameTitleButtonRef = useRef(null);
  const [deleting, setDeleting] = useState(false);
  const [nodes, setNodes] = useState([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Bumping this re-runs the load effect: the failed-load card's Try again
  // pill asks for the same fetch again instead of a page reload.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [photoSize, setPhotoSize] = usePhotoSize();
  const [catalogLayout, setCatalogLayout] = useCatalogLayout();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  // The active grid's drag snapshot: the canvas-level outcome line and the
  // ancestor rail read it; the move itself stays in the grid's own hook.
  const [dragState, setDragState] = useState(null);
  const handleDragState = useCallback((next) => {
    setDragState(next?.sourceId == null ? null : next);
  }, []);

  // The merged add dialog's insertion point. `parent` is the container whose
  // grid the add tile or item menu belongs to; `afterId` null means append.
  const [addTarget, setAddTarget] = useState(null);
  // A catalog shell or note card waiting for the one library note that
  // replaces it in place.
  const [replaceNodeId, setReplaceNodeId] = useState(null);
  // The name dialog: adding a grouping after an item, or renaming a node.
  const [nameDialog, setNameDialog] = useState(null);
  // The catalog shell whose metadata is being edited.
  const [editShellId, setEditShellId] = useState(null);
  // The card whose "Move into…" dialog is open.
  const [moveTargetId, setMoveTargetId] = useState(null);
  // The top-level Category whose subtree is being copied to another Showcase.
  const [duplicateSourceId, setDuplicateSourceId] = useState(null);
  // Card to refocus when the overlay closes; not part of the URL.
  const noteEditorReturnNodeIdRef = useRef(null);
  const noteEditorOverlayRef = useRef(null);
  const noteEditorDirtyRef = useRef(false);
  const handleNoteEditorDirtyChange = useCallback((dirty) => {
    noteEditorDirtyRef.current = dirty;
  }, []);

  // The Note opened from an item menu rides in the shared editor overlay above
  // the canvas. The URL names it (`#edit/<noteId>`) so a reload lands back in
  // the editor; the loaded tree supplies the Collection the form scopes to and
  // the card that takes focus when the overlay closes.
  const editingNoteId = parseNoteEditorHash(location.hash);
  const editingNote = useMemo(() => {
    const nodeId =
      editingNoteId == null ? null : findNodeIdForNote(nodes, editingNoteId);
    const node = nodeId == null ? null : findNodeById(nodes, nodeId);

    if (!node) {
      return null;
    }

    const note =
      node.node_type === "note"
        ? node.note
        : node.specimens?.find((specimen) => specimen?.id === editingNoteId);

    return note
      ? { id: editingNoteId, collectionId: note.collection_id ?? null, nodeId }
      : null;
  }, [editingNoteId, nodes]);

  const [presentIndex, setPresentIndex] = useState(null);
  const presentReturnNodeIdRef = useRef(null);
  const ownershipFocusRef = useRef(null);
  const restoreFocusNodeIdRef = useRef(null);

  // Keep the local name draft in step with the provider row. The draft only
  // exists while the title is a field; opening the field seeds it from the row
  // and closing it drops back to the row's name.
  useEffect(() => {
    if (renamingName) {
      return;
    }

    setNameDraft(showcaseName);
  }, [renamingName, showcaseName]);

  // Entering the rename lands the cursor in the title field, selected, so the
  // name can be retyped at once.
  useEffect(() => {
    if (!renamingName) {
      return;
    }

    const field = nameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [renamingName]);

  useEffect(() => {
    // The hub-owned `new` draft route is retired: a showcase row exists before
    // its view opens, so a non-numeric id can only be a stale bookmark.
    if (!Number.isInteger(showcaseId) || showcaseId <= 0) {
      navigate(SHOWCASE_ROUTES.showcases, { replace: true });
    }
  }, [navigate, showcaseId]);

  useEffect(() => {
    let active = true;

    if (!Number.isInteger(showcaseId) || showcaseId <= 0) {
      setNodes([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setLoadError("");

    async function load() {
      try {
        const [tree, pool] = await Promise.all([
          getShowcaseTree(showcaseId),
          getCategories(),
        ]);

        if (!active) {
          return;
        }

        setNodes(tree.nodes ?? []);
        setCategories(pool.categories ?? []);
        setActionError("");
      } catch (error) {
        if (active) {
          setLoadError(error.message || "Could not load the showcase.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [loadAttempt, showcaseId]);

  function reportActionError(error, fallback) {
    const message = error?.message || fallback;
    setActionError(message);
    toastHost?.current?.show(message, "danger");
  }

  function replaceServerNode(updated) {
    if (!updated?.id) {
      return;
    }

    setNodes((current) =>
      updateNodeTree(current, updated.id, (node) => ({
        ...node,
        ...updated,
        children: node.children,
      })),
    );
  }

  // Put freshly created nodes immediately after the item the menu named, or at
  // the end of the parent. The server appends on create, so an insert-after is
  // a follow-up reorder of the whole sibling list.
  async function placeCreated(parentId, afterId, created) {
    if (!created.length) {
      return;
    }

    const createdIds = created.map((node) => node.id);
    const parent = parentId == null ? null : findNodeById(nodesRef.current, parentId);
    const siblings = parentId == null ? nodesRef.current : (parent?.children ?? []);
    const existingIds = siblings
      .map((node) => node.id)
      .filter((nodeId) => !createdIds.includes(nodeId));
    const anchor = afterId == null ? -1 : existingIds.indexOf(afterId);
    const insertAt = anchor < 0 ? existingIds.length : anchor + 1;
    const desired = [
      ...existingIds.slice(0, insertAt),
      ...createdIds,
      ...existingIds.slice(insertAt),
    ];

    if (afterId != null) {
      try {
        await reorderNodes(showcaseId, parentId, desired);
      } catch (error) {
        reportActionError(error, "Could not place the new item.");

        // The server created the nodes but kept them at the end. Refetch so
        // the canvas never claims an order the server did not accept.
        try {
          const tree = await getShowcaseTree(showcaseId);
          setNodes(tree.nodes ?? []);
        } catch {
          // The action error is already on screen.
        }
        return;
      }
    }

    setNodes((current) => {
      let next = appendChildren(current, parentId, created);

      if (next === current) {
        // The parent vanished during the request; fall back to the root.
        next = [...current, ...created];
      }

      return reorderNodeTree(next, parentId, desired);
    });
    refreshShowcases?.().catch(() => {});
  }

  function startNameRename() {
    if (!showcase) {
      return;
    }

    setNameDraft(showcase.name);
    setNameError("");
    setRenamingName(true);
  }

  function cancelNameRename() {
    if (savingName) {
      return;
    }

    setRenamingName(false);
    setNameDraft(showcaseName);
    setNameError("");
    requestAnimationFrame(() => nameTitleButtonRef.current?.focus?.());
  }

  async function submitNameRename(event) {
    event?.preventDefault?.();

    if (!showcase || savingName) {
      return;
    }

    const trimmed = nameDraft.trim();

    if (!trimmed) {
      setNameError("A showcase name is required.");
      return;
    }

    if (trimmed === showcase.name) {
      cancelNameRename();
      return;
    }

    setSavingName(true);
    setNameError("");

    try {
      await renameShowcase(showcase.id, trimmed);
      setNameDraft(trimmed);
      setRenamingName(false);
      requestAnimationFrame(() => nameTitleButtonRef.current?.focus?.());
    } catch (error) {
      setNameError(error.message || "Could not rename the showcase.");
    } finally {
      setSavingName(false);
    }
  }

  function handleNameKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusCardAt(0);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelNameRename();
    }
  }

  async function handleDelete() {
    if (!showcase || deleting) {
      return;
    }

    const confirmed = await confirm({
      body: "This removes the showcase and everything in it. The notes stay in their collections.",
      confirmLabel: "Delete",
      title: `Delete "${showcase.name}"?`,
    });

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const { nextShowcaseId } = await deleteShowcase(showcase.id);

      if (nextShowcaseId != null) {
        navigate(SHOWCASE_ROUTES.showcase(nextShowcaseId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  async function handleAddCategory(name) {
    const trimmed = String(name ?? "").trim();

    if (!trimmed) {
      throw new Error("Category name is required.");
    }

    const match = categories.find(
      (entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const alreadyPlaced = nodes.some((entry) =>
      match
        ? entry.category_id === match.id
        : entry.node_type === "category" &&
          String(entry.name ?? "").toLowerCase() === trimmed.toLowerCase(),
    );

    if (alreadyPlaced) {
      throw new Error("This category is already in the showcase.");
    }

    const { node } = await createShowcaseNode(showcaseId, {
      ...(match
        ? { type: "category", category_id: match.id }
        : { type: "category", name: trimmed }),
    });
    setNodes((current) => [...current, node]);
    setActionError("");

    await refreshCategoryPool();
    refreshShowcases?.().catch(() => {});
  }

  async function handleReorder(parentId, orderedIds) {
    const previous = nodesRef.current;

    setNodes((current) => reorderNodeTree(current, parentId, orderedIds));

    try {
      await reorderNodes(showcaseId, parentId, orderedIds);
      setActionError("");
    } catch (error) {
      setNodes(previous);
      reportActionError(error, "Could not reorder the items.");
    }
  }

  // Client-side mirror of the move endpoint's placement rules. It keeps an
  // impossible move from touching the canvas at all; the server stays the
  // authority for anything this cannot see.
  function movePlacementError(sourceId, parentId) {
    const source = findNodeById(nodesRef.current, sourceId);

    if (!source) {
      return "The card is no longer here.";
    }

    if (source.node_type === "category" && parentId != null) {
      return "A category placement stays at the top level.";
    }

    if (source.node_type !== "category" && parentId == null) {
      return "That card needs a category or grouping.";
    }

    if (parentId != null) {
      const parent = findNodeById(nodesRef.current, parentId);

      if (
        !parent ||
        (parent.node_type !== "grouping" && parent.node_type !== "category")
      ) {
        return "That level can't hold items.";
      }

      if (
        parent.id === sourceId ||
        findNodeIdPath(nodesRef.current, parent.id).includes(sourceId)
      ) {
        return "A grouping can't move inside itself.";
      }
    }

    return "";
  }

  // Reparent one card. The optimistic tree move lands first; a failed write
  // restores the previous tree so the canvas never claims an order the server
  // did not accept. `position` is the final zero-based sibling index.
  async function handleMoveNode(
    sourceId,
    parentId,
    position,
    { silent = false } = {},
  ) {
    const previous = nodesRef.current;
    const source = findNodeById(previous, sourceId);
    const destination =
      parentId == null ? null : findNodeById(previous, parentId);
    const placementError = movePlacementError(sourceId, parentId);

    if (!source) {
      return false;
    }

    if (placementError) {
      setActionError(placementError);
      setAnnouncement(`Move refused. ${placementError}`);
      toastHost?.current?.show(placementError, "danger");
      return false;
    }

    const previousParentId = findParentId(previous, sourceId);
    const previousSiblings =
      previousParentId == null
        ? previous
        : (findNodeById(previous, previousParentId)?.children ?? []);
    const previousIndex = previousSiblings.findIndex(
      (node) => node.id === sourceId,
    );

    setNodes((current) => moveNodeTree(current, sourceId, parentId, position));

    try {
      await moveNode(sourceId, parentId, position);
      setActionError("");

      if (silent) {
        setAnnouncement("Move undone.");
        return true;
      }

      const message = `Moved “${showcaseNodeLabel(source)}” ${
        destination ? `into “${destination.name}”` : "to the top level"
      }.`;
      setAnnouncement(message);
      toastHost?.current?.show(message, "success", {
        label: "Undo",
        onClick: () => {
          handleMoveNode(sourceId, previousParentId, previousIndex, {
            silent: true,
          });
        },
      });

      if (parentId != null) {
        focusShowcaseControl(
          sectionRef,
          `[data-showcase-node-id="${parentId}"]`,
        );
      }

      return true;
    } catch (error) {
      setNodes(previous);
      reportActionError(error, "Could not move the item.");
      return false;
    }
  }

  // The ancestor rail's drop: append to the chosen level, which is the only
  // outdent gesture when the target level's cards are not on screen.
  function handleDropAtLevel(levelId) {
    if (dragState?.sourceId == null) {
      return;
    }

    const level =
      levelId == null ? null : findNodeById(nodesRef.current, levelId);
    const siblings =
      levelId == null ? nodesRef.current : (level?.children ?? []);
    const position = appendPositionFor(siblings, dragState.sourceId);
    const sourceId = dragState.sourceId;

    setDragState(null);
    handleMoveNode(sourceId, levelId, position);
  }

  // The menu's one-level step out. A card inside a grouping lands at the end
  // of its grandparent (the grouping's category, or the grouping above it);
  // categories and cards already on a level have nothing to step out of, so
  // their menu never offers it.
  function handleMoveOut(node) {
    const current = nodesRef.current;
    const parentId = findParentId(current, node.id);
    const parent = parentId == null ? null : findNodeById(current, parentId);

    if (!parent || parent.node_type !== "grouping") {
      return;
    }

    const destinationId = findParentId(current, parentId);

    if (destinationId == null) {
      return;
    }

    const destination = findNodeById(current, destinationId);
    const position = appendPositionFor(
      destination?.children ?? [],
      node.id,
    );

    handleMoveNode(node.id, destinationId, position);
  }

  function dragOutcomeLabel(state) {
    if (!state) {
      return "";
    }

    const source = findNodeById(nodes, state.sourceId);
    const sourceName = showcaseNodeLabel(source);

    if (state.springId != null) {
      return `Hold to open “${showcaseNodeLabel(findNodeById(nodes, state.springId))}” · release appends`;
    }

    if (state.drawerTarget) {
      const group = findNodeById(nodes, state.drawerId);

      if (state.drawerTarget.placement === "into") {
        return `Into “${showcaseNodeLabel(findNodeById(nodes, state.drawerTarget.parentId))}” · end`;
      }

      return `Inside “${showcaseNodeLabel(group)}” · ${
        state.drawerTarget.placement === "after" ? "after" : "before"
      } “${showcaseNodeLabel(findNodeById(nodes, state.drawerTarget.childId))}”`;
    }

    if (state.drawerId != null && state.target == null) {
      return `Inside “${showcaseNodeLabel(findNodeById(nodes, state.drawerId))}” · between rows to place precisely`;
    }

    if (state.target?.placement === "into") {
      return `Into “${showcaseNodeLabel(findNodeById(nodes, state.target.nodeId))}” · end`;
    }

    if (state.target) {
      return `${
        state.target.placement === "after" ? "After" : "Before"
      } “${showcaseNodeLabel(findNodeById(nodes, state.target.nodeId))}”`;
    }

    return `Moving “${sourceName}” · edges reorder, middle nests`;
  }

  function openAdd(parent, afterId = null, mode = "notes") {
    if (!parent) {
      return;
    }

    setAddTarget({ parent, afterId, mode });
  }

  // The write is already committed; a lagging pool must not read as a failure.
  async function refreshCategoryPool() {
    try {
      const pool = await getCategories();
      setCategories(pool.categories ?? []);
    } catch {
      // The canvas keeps its current suggestions.
    }
  }

  // An unused pool label can be deleted straight from the suggestion list; the
  // dialog keeps itself open and the row disappears once the write lands.
  async function handleDeleteSuggestion(category) {
    await deleteCategory(category.id);
    setCategories((current) =>
      current.filter((entry) => entry.id !== category.id),
    );
  }

  function openAddCategory() {
    setNameDialog({
      kind: "add-category",
      title: "New category",
      subtitle:
        "Reuse a category from the pool or type a new name; Add category places it in the showcase.",
      label: "Category name",
      initialValue: "",
      submitLabel: "Add category",
      suggestionsLabel: "Category suggestions",
      onDeleteSuggestion: handleDeleteSuggestion,
    });
  }

  function openAddAfter(parent, node, mode) {
    if (mode === "grouping") {
      setNameDialog({
        kind: "add-grouping",
        parentId: parent?.id ?? null,
        afterId: node?.id ?? null,
        title: "Add grouping",
        subtitle: `The grouping lands after “${node?.name ?? "this item"}”.`,
        label: "Grouping name",
        initialValue: "",
        submitLabel: "Add grouping",
      });
      return;
    }

    openAdd(parent, node?.id ?? null, mode);
  }

  async function handleAddNotes(noteIds, allNotes) {
    if (!addTarget?.parent?.id) {
      throw new Error("Notes need a category or grouping.");
    }

    const byId = new Map((allNotes ?? []).map((note) => [note.id, note]));
    const orderedIds = (noteIds ?? []).filter((noteId) =>
      Number.isInteger(noteId) && byId.has(noteId),
    );

    if (!orderedIds.length) {
      return;
    }

    try {
      const result = await createShowcaseNode(showcaseId, {
        type: "notes",
        parent_id: addTarget.parent.id,
        note_ids: orderedIds,
      });
      await placeCreated(addTarget.parent.id, addTarget.afterId, result.nodes ?? []);
      setActionError("");
    } catch (error) {
      reportActionError(error, "Could not add the notes.");
      throw error;
    }
  }

  async function handleAddShells(entries) {
    if (!addTarget?.parent?.id) {
      throw new Error("A placeholder needs a category or grouping.");
    }

    const created = [];

    try {
      for (const entry of entries ?? []) {
        const { node } = await createCatalogEntry(showcaseId, {
          parentId: addTarget.parent.id,
          entry,
        });
        created.push(node);
      }

      await placeCreated(addTarget.parent.id, addTarget.afterId, created);
      setActionError("");
    } catch (error) {
      reportActionError(error, "Could not add the placeholders.");
      throw error;
    }
  }

  async function handleAddGrouping(name) {
    if (!addTarget?.parent?.id) {
      throw new Error("A grouping needs a category or grouping.");
    }

    const { node } = await createShowcaseNode(showcaseId, {
      type: "grouping",
      parent_id: addTarget.parent.id,
      name,
    });
    await placeCreated(addTarget.parent.id, addTarget.afterId, [node]);
    setActionError("");
  }

  async function submitNameDialog(trimmed) {
    if (!nameDialog) {
      return;
    }

    if (nameDialog.kind === "add-category") {
      await handleAddCategory(trimmed);
      return;
    }

    if (nameDialog.kind === "add-grouping") {
      if (nameDialog.parentId == null) {
        throw new Error("A grouping needs a category or grouping.");
      }

      const { node } = await createShowcaseNode(showcaseId, {
        type: "grouping",
        parent_id: nameDialog.parentId,
        name: trimmed,
      });
      await placeCreated(nameDialog.parentId, nameDialog.afterId, [node]);
      setActionError("");
      return;
    }

    const target = findNodeById(nodesRef.current, nameDialog.node.id);

    if (!target || trimmed === target.name) {
      return;
    }

    // The dialog owns the error line for a failed rename; adding a banner or
    // toast here would show the same message twice.
    const { node } = await updateNode(target.id, { name: trimmed });
    replaceServerNode(node);
    setActionError("");

    if (target.node_type === "category") {
      // The rename is already committed; a lagging pool must not read as one.
      await refreshCategoryPool();
      refreshShowcases?.().catch(() => {});
    }
  }

  function openRename(node) {
    const isCategory = node.node_type === "category";
    setNameDialog({
      kind: "rename",
      node,
      title: `Rename ${isCategory ? "category" : "grouping"}`,
      subtitle: isCategory
        ? "Pick a category from the pool or type a new name. Only this showcase changes."
        : "The new name is saved immediately.",
      label: "Name",
      initialValue: node.name ?? "",
      submitLabel: "Save name",
      suggestionsLabel: isCategory ? "Category suggestions" : undefined,
    });
  }

  async function handleDuplicateCategory(targetShowcaseId) {
    const source =
      duplicateSourceId == null
        ? null
        : findNodeById(nodesRef.current, duplicateSourceId);

    if (!source) {
      throw new Error("This category is no longer on the canvas.");
    }

    const target = showcases.find((entry) => entry.id === targetShowcaseId);

    // The copy lives in the target: the source canvas stays exactly as it is.
    const { node } = await duplicateNode(source.id, targetShowcaseId);
    setActionError("");
    toastHost?.current?.show(
      `Duplicated ${node?.name ?? source.name} to ${target?.name ?? "showcase"}`,
      "success",
    );

    await refreshCategoryPool();
    refreshShowcases?.().catch(() => {});
  }

  async function handleMoveCategory(node, direction) {
    const ids = nodesRef.current.map((entry) => entry.id);
    const index = ids.indexOf(node.id);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) {
      return;
    }

    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    await handleReorder(null, ids);
  }

  async function handleRemove(node) {
    if (!node) {
      return;
    }

    const label =
      node.node_type === "grouping"
        ? node.name
        : node.node_type === "category"
          ? node.name
          : node.node_type === "note"
            ? noteNodeLabel(node)
            : catalogEntryIdentity(node.entry);
    const confirmed = await confirm({
      title: `Remove “${label}” from this showcase?`,
      body:
        node.node_type === "grouping"
          ? "The grouping and everything inside it leave this showcase. The notes stay in their collections."
          : "The card leaves this showcase. The note stays in its collection.",
      confirmLabel: "Remove",
      cancelLabel: "Keep",
    });

    if (!confirmed) {
      return;
    }

    const parentId = findParentId(nodesRef.current, node.id);

    try {
      await deleteNode(node.id);
      setNodes((current) => removeNodeTree(current, node.id));
      setActionError("");
      refreshShowcases?.().catch(() => {});

      const onCurrentPath = urlDrillIds.includes(node.id);

      if (onCurrentPath) {
        navigate({ search: showcaseNodeSearch(parentId) });
      }
    } catch (error) {
      reportActionError(error, "Could not remove the item.");
    }
  }

  async function handleSetCover(noteNode) {
    if (!displayNode || displayNode.node_type !== "grouping") {
      return;
    }

    const coverNoteId = noteNode.note_id ?? noteNode.note?.id ?? null;

    try {
      const { node } = await updateNode(displayNode.id, {
        cover_note_id: coverNoteId,
      });
      replaceServerNode(node);
      setActionError("");
    } catch (error) {
      reportActionError(error, "Could not set the cover.");
    }
  }

  async function handleClearCover(groupingNode) {
    try {
      const { node } = await updateNode(groupingNode.id, {
        cover_note_id: null,
      });
      replaceServerNode(node);
      setActionError("");
    } catch (error) {
      reportActionError(error, "Could not clear the cover.");
    }
  }

  async function handleEditShell(entries) {
    const target = editShellId == null ? null : findNodeById(nodesRef.current, editShellId);

    if (!target) {
      return;
    }

    try {
      const { node } = await updateCatalogEntry(target.id, entries[0] ?? {});
      replaceServerNode(node);
      setActionError("");
    } catch (error) {
      reportActionError(error, "Could not save the placeholder.");
      throw error;
    }
  }

  async function handleReplaceNode(noteIds) {
    const target =
      replaceNodeId == null ? null : findNodeById(nodesRef.current, replaceNodeId);
    const noteId = noteIds?.[0];

    if (!target || noteId == null) {
      return;
    }

    const wasShell = isCatalogEntry(target);

    try {
      // A shell converts to a note; a note card swaps the note it presents.
      // Both keep the node's id, parent, and position.
      const { node } = wasShell
        ? await replaceCatalogEntryWithNote(target.id, noteId)
        : await updateNode(target.id, { note_id: noteId });
      let replaced =
        node?.node_type === "note" && node.note_id === noteId ? node : null;

      if (!replaced) {
        // A write that answers 200 without converting the node is not a
        // success. Adopt the server's tree so the canvas shows what the server
        // actually holds before the mismatch is reported.
        const tree = await getShowcaseTree(showcaseId).catch(() => null);

        if (tree) {
          setNodes(tree.nodes ?? []);
          replaced = findNodeById(tree.nodes ?? [], target.id);
        }
      }

      if (!replaced || replaced.node_type !== "note" || replaced.note_id !== noteId) {
        throw new Error(
          wasShell
            ? "The placeholder was not replaced."
            : "The note was not replaced.",
        );
      }

      replaceServerNode(replaced);
      setReplaceNodeId(null);
      setActionError("");
      refreshShowcases?.().catch(() => {});
      toastHost?.current?.show(
        wasShell ? "Placeholder replaced with a note." : "Note replaced.",
        "success",
      );
    } catch (error) {
      reportActionError(
        error,
        wasShell ? "Could not replace the shell." : "Could not replace the note.",
      );
      throw error;
    }
  }

  // ── Catalog checklist writes ─────────────────────────────────────────────
  function noteOwnershipPayload(note, owned) {
    return {
      catalog_number: note.catalog_number ?? "",
      denomination: note.denomination ?? "",
      grading_company: note.grading_company ?? "",
      grade: note.grade ?? "",
      issue_date: note.issue_date ?? "",
      notes: note.notes ?? "",
      owned,
      scraped_data: note.scraped_data ?? null,
      serial: note.serial ?? "",
      tags: (Array.isArray(note.tags) ? note.tags : [])
        .map((tag) => (typeof tag === "string" ? tag : tag?.name))
        .filter(Boolean),
      url: note.url ?? "",
      watermark: note.watermark ?? "",
    };
  }

  async function applyNoteOwnership(
    note,
    owned,
    { nodeId = null, announce = true } = {},
  ) {
    const previous = noteOwnedInTree(nodes, note.id) ?? note.owned;
    const targetNodeId = nodeId ?? findNodeIdForNote(nodes, note.id);
    const label = showcaseNoteDisplayParts(note).join(" · ") || "Note";

    setNodes((current) => setNoteOwned(current, note.id, owned));
    ownershipFocusRef.current = {
      nodeId: targetNodeId,
      role: owned ? "check" : "ownership",
    };

    try {
      await updateNote(
        note.id,
        noteOwnershipPayload(note, owned),
        note.collection_id,
      );
      refreshShowcases?.().catch(() => {});

      if (!announce) {
        return;
      }

      toastHost?.current?.show(
        `${label} marked ${owned ? "owned" : "not owned"}`,
        "success",
        {
          label: "Undo",
          onClick: () => {
            applyNoteOwnership(note, previous, {
              announce: false,
              nodeId: targetNodeId,
            });
          },
        },
      );
    } catch (error) {
      setNodes((current) => setNoteOwned(current, note.id, previous));
      toastHost?.current?.show(
        error.message || "Could not update ownership.",
        "danger",
      );
    }
  }

  function handleOwnershipToggle(note, owned, nodeId = null) {
    if (note) {
      applyNoteOwnership(note, owned, { nodeId });
    }
  }

  // ── Note editor ───────────────────────────────────────────────────────────
  // Editing a note changes its own record, not the Showcase structure: the
  // canvas stays as it is and the shared editor opens over it. Saving refetches
  // the tree so every card and slide shows the new record.
  function navigateNoteEditor(noteId, { replace = false } = {}) {
    const hash = noteId == null ? "" : noteEditorHash(noteId);
    navigate(showcaseLocation(location, { hash }), { replace });
  }

  function openNoteEditor(note, nodeId = null) {
    if (!note?.id) {
      return;
    }

    noteEditorReturnNodeIdRef.current = nodeId;
    navigateNoteEditor(note.id);
  }

  function closeNoteEditor() {
    navigateNoteEditor(null, { replace: true });
  }

  // Closing discards the form, so an edited Note asks first, with Keep editing
  // as the safe default, exactly like the Table screen's editor overlay.
  function guardNoteEditorExit(action) {
    if (confirmOpen) {
      return;
    }

    if (!noteEditorDirtyRef.current) {
      action();
      return;
    }

    confirm({
      title: "Discard changes?",
      body: "Your changes will be lost.",
      cancelLabel: "Keep editing",
      confirmLabel: "Discard",
    }).then((confirmed) => {
      if (confirmed) {
        action();
      }
    });
  }

  async function handleNoteSaved(
    _savedNote,
    _reorderedNotes,
    _collection,
    intent = "return",
  ) {
    // Save and stay keeps the editor open on the saved Note, matching the
    // Table screen; the form's own live region reports that save. Only a
    // return closes the overlay and adds the toast.
    if (intent !== "stay") {
      closeNoteEditor();
      toastHost?.current?.show("Note saved", "success");
    }

    try {
      const tree = await getShowcaseTree(showcaseId);
      setNodes(tree.nodes ?? []);
    } catch (error) {
      reportActionError(error, "Could not refresh the showcase.");
    }

    // A save can change what the showcase list row counts: a catalog showcase
    // prints owned over total entries, so toggling a note's ownership here has
    // to reach the rail's badge as well as the canvas. The tree above repaints
    // the cards; this keeps the collapsed row in step with them.
    refreshShowcases?.().catch(() => {});
  }

  // Closing returns focus to the card the menu belonged to, so the canvas
  // picks up where the collector left it. Opening from a `#edit/<noteId>` URL
  // has no menu hand-off, so the tree-resolved card fills the gap.
  useEffect(() => {
    if (editingNote != null) {
      noteEditorReturnNodeIdRef.current ??= editingNote.nodeId;
      return;
    }

    const nodeId = noteEditorReturnNodeIdRef.current;

    if (nodeId == null) {
      return;
    }

    noteEditorReturnNodeIdRef.current = null;
    const cardSelector = `.showcase-card[data-showcase-node-id="${nodeId}"]`;
    const selector = sectionRef.current?.querySelector(cardSelector)
      ? cardSelector
      : SHOWCASE_CARD_SELECTOR;
    focusShowcaseControl(sectionRef, selector);
  }, [editingNote]);

  // A `#edit/<noteId>` whose Note is not in this Showcase (deleted, or a stale
  // bookmark) falls back to the canvas, matching a `?node=` that no longer
  // resolves.
  useEffect(() => {
    if (loading || loadError || editingNoteId == null || editingNote != null) {
      return;
    }

    navigate(showcaseLocation(location, { hash: "" }), { replace: true });
  }, [
    editingNote,
    editingNoteId,
    loading,
    loadError,
    location,
    navigate,
  ]);

  // Escape belongs to the editor while it is open: a focused field gets the
  // first press (blur keeps the collector in the editor), and a second press
  // asks to discard or closes an untouched form.
  useEffect(() => {
    if (editingNote == null) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || confirmOpen) {
        return;
      }

      const activeElement = document.activeElement;

      if (
        isEditableElement(activeElement) &&
        noteEditorOverlayRef.current?.contains(activeElement)
      ) {
        activeElement.blur();
        return;
      }

      guardNoteEditorExit(closeNoteEditor);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, editingNote]);

  // ── Preview and presentation ─────────────────────────────────────────────
  const entryNode = new URLSearchParams(location.search).get("node");
  const urlDrillIds = entryNode
    ? findNodeIdPath(nodes, Number(entryNode))
    : [];
  const currentPath = findNodePath(nodes, urlDrillIds);
  const currentNode = currentPath.length
    ? currentPath[currentPath.length - 1]
    : null;
  // The view toolbar belongs to every Showcase, and every note leaf reads as a
  // catalog card, whether or not the tree has placeholders. Note leaves carry an
  // owned flag too, so the filters, meter, and Complete chip read the same
  // states either way.
  const showViewToolbar = !loadError;
  const displayNode =
    currentNode?.node_type === "category" ? null : currentNode;
  const displayPath = displayNode ? currentPath : [];
  const displayChildren = displayNode ? (displayNode.children ?? []) : nodes;
  const filterActive = cardFilter !== "all";
  const filteredDisplayChildren = filterActive
    ? filterCatalogTree(displayChildren, cardFilter)
    : displayChildren;
  const isRootExpanded = displayNode == null;
  // An empty Showcase already has its own invitation; a filter on it must not
  // stack a second empty box on top.
  const filterEmpty =
    filterActive &&
    filteredDisplayChildren.length === 0 &&
    displayChildren.length > 0;
  const activeFilter =
    CARD_FILTERS.find((filter) => filter.value === cardFilter) ??
    CARD_FILTERS[0];
  const filterEmptyText = activeFilter.emptyText;
  // One slide per owned card: a catalog entry uses its primary, a note leaf
  // its own Note. Seen and unseen cards are skipped. A presentation-only
  // Showcase reads note leaves through the same owned flag.
  const presentationNotes = useMemo(
    () => catalogPresentationNotes(nodes),
    [nodes],
  );
  const slideshowReady = presentationNotes.length > 0;
  const slideshowTitle = slideshowReady
    ? "Show the notes you own as a slideshow"
    : "Add an owned note to start a slideshow";
  // The chips and the meter describe the level on screen, never the whole
  // Showcase: drilled into a Grouping, "All 3" has to agree with the three
  // cards beneath it. At the root the two readings are the same.
  const levelTotals = catalogCounts(displayChildren);
  // The meter keeps its slot even when the level is empty, so the toolbar's
  // trailing cluster never slides left. A zero-range bar is decoration, not a
  // progressbar.
  const meterAria =
    levelTotals.total > 0
      ? {
          "aria-label": "Owned cards",
          "aria-valuemax": levelTotals.total,
          "aria-valuemin": 0,
          "aria-valuenow": levelTotals.owned,
          "aria-valuetext": `${levelTotals.owned} of ${levelTotals.total} owned`,
          role: "progressbar",
        }
      : { "aria-hidden": "true" };

  const previewParamRaw = new URLSearchParams(location.search).get("preview");
  const previewRequest = previewParamRaw
    ? parseShowcasePreviewParam(previewParamRaw)
    : null;
  const previewItems = useMemo(
    () => getShowcasePreviewItems(nodes),
    [nodes],
  );
  const previewIndex = previewRequest
    ? findShowcasePreviewIndex(
        previewItems,
        previewRequest.nodeId,
        previewRequest.kind,
      )
    : -1;
  const previewOpen = previewRequest != null && previewIndex >= 0;
  const activePreviewItem = previewOpen ? previewItems[previewIndex] : null;
  const neighbouringPreviewImages = useMemo(
    () =>
      previewOpen ? neighbouringImageSources(previewItems, previewIndex) : [],
    [previewIndex, previewItems, previewOpen],
  );
  useImagePreload(neighbouringPreviewImages, { delay: 120 });
  const restorePreviewFocusNodeIdRef = useRef(null);
  const wasPreviewOpenRef = useRef(false);

  function openShowcasePreview(node, kind) {
    if (node?.node_type !== "note") {
      return;
    }

    const nodeItems = previewItems.filter((item) => item.nodeId === node.id);

    if (!nodeItems.length) {
      return;
    }

    const item = nodeItems.find((entry) => entry.kind === kind) ?? nodeItems[0];
    restorePreviewFocusNodeIdRef.current = node.id;
    const nodeRaw = new URLSearchParams(location.search).get("node");
    navigate({
      search: buildShowcasePreviewSearch({
        node: nodeRaw,
        previewKind: item.kind,
        previewNodeId: item.nodeId,
      }),
    });
  }

  function replaceShowcasePreview(item) {
    const levelId = getShowcasePreviewContainingLevelId(nodes, item.nodeId);
    restorePreviewFocusNodeIdRef.current = item.nodeId;
    navigate(
      {
        search: buildShowcasePreviewSearch({
          node: levelId,
          previewKind: item.kind,
          previewNodeId: item.nodeId,
        }),
      },
      { replace: true },
    );
  }

  function moveShowcasePreview(offset) {
    if (!previewOpen || previewItems.length === 0) {
      return;
    }

    const next =
      previewItems[
        (previewIndex + offset + previewItems.length) % previewItems.length
      ];

    if (next) {
      replaceShowcasePreview(next);
    }
  }

  function selectShowcaseSide(kind) {
    if (!activePreviewItem) {
      return;
    }

    const target = previewItems.find(
      (item) => item.nodeId === activePreviewItem.nodeId && item.kind === kind,
    );

    if (target) {
      replaceShowcasePreview(target);
    }
  }

  function jumpShowcasePreview(position) {
    const target = previewItems[position - 1];

    if (target) {
      replaceShowcasePreview(target);
      return true;
    }

    return false;
  }

  function startShowcasePreview() {
    const first = previewItems[0];

    if (first && previewIndex !== 0) {
      replaceShowcasePreview(first);
      return true;
    }

    return false;
  }

  function endShowcasePreview() {
    const last = previewItems[previewItems.length - 1];

    if (last && previewIndex !== previewItems.length - 1) {
      replaceShowcasePreview(last);
      return true;
    }

    return false;
  }

  function closeShowcasePreview() {
    const params = new URLSearchParams(location.search);
    const nodeRaw = params.get("node");
    const nodeResolves =
      nodeRaw == null || findNodeIdPath(nodes, Number(nodeRaw)).length > 0;

    if (nodeResolves) {
      params.delete("preview");
      const text = params.toString();
      navigate({ search: text ? `?${text}` : "" }, { replace: true });
      return;
    }

    const levelId =
      activePreviewItem != null
        ? getShowcasePreviewContainingLevelId(nodes, activePreviewItem.nodeId)
        : null;
    navigate({ search: showcaseNodeSearch(levelId) }, { replace: true });
  }

  useEffect(() => {
    if (loading || previewParamRaw == null || previewOpen) {
      return;
    }

    if (previewRequest == null || previewIndex < 0) {
      const params = new URLSearchParams(location.search);
      params.delete("preview");
      const text = params.toString();
      navigate(showcaseLocation(location, { search: text ? `?${text}` : "" }), {
        replace: true,
      });
    }
  }, [
    loading,
    location,
    navigate,
    previewIndex,
    previewOpen,
    previewParamRaw,
    previewRequest,
  ]);

  useEffect(() => {
    if (wasPreviewOpenRef.current && !previewOpen) {
      const nodeId = restorePreviewFocusNodeIdRef.current;
      restorePreviewFocusNodeIdRef.current = null;

      if (nodeId != null) {
        focusShowcaseControl(
          sectionRef,
          `.showcase-card[data-showcase-node-id="${nodeId}"]`,
        );
      }
    }

    wasPreviewOpenRef.current = previewOpen;
  }, [previewOpen]);

  // A `?node=` that no longer resolves falls back to the root.
  useEffect(() => {
    if (loading || !entryNode) {
      return;
    }

    if (findNodeIdPath(nodes, Number(entryNode)).length === 0) {
      const params = new URLSearchParams(location.search);
      params.delete("node");
      const text = params.toString();
      navigate(showcaseLocation(location, { search: text ? `?${text}` : "" }), {
        replace: true,
      });
    }
  }, [entryNode, loading, location, navigate, nodes]);

  // The live region counts the same cards the filter chips count, so one
  // screen never uses two units for the same list.
  const announcedCount = filterActive
    ? catalogCounts(filteredDisplayChildren).total
    : levelTotals.total;

  useEffect(() => {
    if (loading) {
      return;
    }

    const name = displayNode ? displayNode.name : showcaseName;
    const noun = announcedCount === 1 ? "card" : "cards";
    // A filter change re-announces on purpose: the count is the answer to the
    // filter, so the live region names the filter it counted.
    const filterSuffix =
      cardFilter !== "all"
        ? `, ${activeFilter.label.toLowerCase()} filter`
        : "";

    setAnnouncement(
      `${name}, ${announcedCount} ${noun}${filterSuffix}`,
    );
  }, [
    activeFilter,
    announcedCount,
    cardFilter,
    displayNode,
    loading,
    showcaseName,
  ]);

  function openNode(node) {
    if (node?.node_type === "category") {
      return;
    }

    restoreFocusNodeIdRef.current = node.id;
    navigate({ search: showcaseNodeSearch(node.id) });
  }

  function navigateTo(targetIndex) {
    restoreFocusNodeIdRef.current = displayNode?.id ?? null;
    const rawTargetId =
      targetIndex < 0 ? null : (urlDrillIds[targetIndex] ?? null);
    const target =
      rawTargetId == null ? null : findNodeById(nodes, rawTargetId);
    const targetId = target?.node_type === "category" ? null : rawTargetId;
    navigate({ search: showcaseNodeSearch(targetId) });
  }

  function openPresentation(nodeId = null) {
    if (!presentationNotes.length) {
      return;
    }

    const index =
      nodeId == null
        ? 0
        : presentationNotes.findIndex((item) => item.nodeId === nodeId);
    const resolved = index >= 0 ? index : 0;

    presentReturnNodeIdRef.current = presentationNotes[resolved]?.nodeId ?? null;
    setPresentIndex(resolved);
  }

  function closePresentation() {
    setPresentIndex(null);
  }

  useEffect(() => {
    if (presentIndex != null) {
      return;
    }

    const nodeId = presentReturnNodeIdRef.current;

    if (nodeId == null) {
      return;
    }

    presentReturnNodeIdRef.current = null;
    focusShowcaseControl(
      sectionRef,
      `.showcase-card[data-showcase-node-id="${nodeId}"]`,
    );
  }, [presentIndex]);

  useEffect(() => {
    const target = ownershipFocusRef.current;

    if (!target || target.nodeId == null || loading) {
      return;
    }

    ownershipFocusRef.current = null;
    const targetSelector =
      `.showcase-catalog-cell[data-showcase-node-id="${target.nodeId}"] ` +
      `[data-showcase-focus="${target.role}"]`;
    const selector = sectionRef.current?.querySelector(targetSelector)
      ? targetSelector
      : `[data-showcase-filter="${cardFilter}"]`;
    focusShowcaseControl(sectionRef, selector);
  }, [cardFilter, loading, nodes]);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  const drillDepth = urlDrillIds.length;

  function showcaseCardElements() {
    const root = sectionRef.current;

    if (!root) {
      return [];
    }

    return Array.from(root.querySelectorAll(SHOWCASE_CARD_SELECTOR));
  }

  function focusedShowcaseCard() {
    const active = document.activeElement;

    if (!(active instanceof Element) || !sectionRef.current?.contains(active)) {
      return null;
    }

    return (
      active.closest(SHOWCASE_CARD_SELECTOR) ??
      active
        .closest(".showcase-reorder-cell, .showcase-cell")
        ?.querySelector(".showcase-card") ??
      null
    );
  }

  function moveCardFocus(offset) {
    const cards = showcaseCardElements();

    if (!cards.length) {
      return;
    }

    const current = focusedShowcaseCard();
    const currentIndex = current ? cards.indexOf(current) : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      cards.length - 1,
    );

    cards[nextIndex]?.focus();
  }

  function focusCardAt(index) {
    const cards = showcaseCardElements();

    if (!cards.length) {
      return;
    }

    const clamped = Math.min(Math.max(index, 0), cards.length - 1);
    cards[clamped]?.focus();
  }

  function cardPageStep(cards) {
    if (cards.length < 2) {
      return 1;
    }

    const rects = cards.map((card) => card.getBoundingClientRect());
    const firstTop = rects[0].top;
    const columns =
      rects.filter((rect) => Math.abs(rect.top - firstTop) < 1).length || 1;
    const tops = Array.from(
      new Set(rects.map((rect) => Math.round(rect.top))),
    ).sort((a, b) => a - b);
    const pitch = tops.length > 1 ? tops[1] - tops[0] : rects[0].height;
    const viewport = window.innerHeight || 0;
    const rowsPerPage =
      pitch > 0 && viewport > 0 ? Math.max(1, Math.floor(viewport / pitch)) : 1;

    return Math.max(1, rowsPerPage * columns);
  }

  function pageCardFocus(direction) {
    const cards = showcaseCardElements();

    if (!cards.length) {
      return;
    }

    const current = focusedShowcaseCard();
    const currentIndex = current ? cards.indexOf(current) : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;

    focusCardAt(baseIndex + direction * cardPageStep(cards));
  }

  useEffect(() => {
    function handleGlobalKeyDown(event) {
      if (
        showShortcutsHelp ||
        addTarget != null ||
        replaceNodeId != null ||
        nameDialog != null ||
        editShellId != null ||
        editingNote != null ||
        confirmOpen ||
        presentIndex != null
      ) {
        return;
      }

      if (previewOpen) {
        return;
      }

      if (isEditableElement(event.target)) {
        return;
      }

      if (
        event.target instanceof Element &&
        event.target.closest("#app-sidebar")
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }

      const down = event.key === "ArrowDown" || event.key === "j";
      const up = event.key === "ArrowUp" || event.key === "k";
      const next = event.key === "ArrowRight" || event.key === "l";
      const previous = event.key === "ArrowLeft" || event.key === "h";

      if (down || next) {
        event.preventDefault();
        moveCardFocus(1);
        return;
      }

      if (up || previous) {
        event.preventDefault();
        moveCardFocus(-1);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        focusCardAt(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        focusCardAt(showcaseCardElements().length - 1);
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        pageCardFocus(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.key === "a") {
        const card = focusedShowcaseCard();
        const nodeId =
          card?.dataset?.showcaseNodeId != null
            ? Number(card.dataset.showcaseNodeId)
            : null;
        const node = Number.isInteger(nodeId)
          ? findNodeById(nodesRef.current, nodeId)
          : null;
        const parentId = node ? findParentId(nodesRef.current, node.id) : null;
        const parent =
          parentId == null ? null : findNodeById(nodesRef.current, parentId);

        if (node && parent) {
          event.preventDefault();
          openAddAfter(parent, node, "notes");
        }

        return;
      }

      if (event.key === "Escape") {
        const card = focusedShowcaseCard();

        if (card) {
          event.preventDefault();

          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }

          return;
        }

        if (drillDepth > 0) {
          event.preventDefault();
          navigateTo(drillDepth - 2);
        }
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addTarget,
    cardFilter,
    confirmOpen,
    displayNode,
    drillDepth,
    editShellId,
    editingNote,
    nameDialog,
    presentIndex,
    previewOpen,
    replaceNodeId,
    showShortcutsHelp,
  ]);

  const drillKey = urlDrillIds.join("/");

  useEffect(() => {
    if (loading) {
      return;
    }

    const nodeId = restoreFocusNodeIdRef.current;

    if (nodeId == null) {
      return;
    }

    restoreFocusNodeIdRef.current = null;

    const card = sectionRef.current?.querySelector(
      `.showcase-card[data-showcase-node-id="${nodeId}"]`,
    );

    card?.focus();
  }, [drillKey, loading]);

  const replaceNode =
    replaceNodeId == null ? null : findNodeById(nodes, replaceNodeId);
  const editShellNode =
    editShellId == null ? null : findNodeById(nodes, editShellId);
  const moveTargetNode =
    moveTargetId == null ? null : findNodeById(nodes, moveTargetId);
  const duplicateSourceNode =
    duplicateSourceId == null
      ? null
      : findNodeById(nodes, duplicateSourceId);
  const otherShowcases = useMemo(
    () => showcases.filter((entry) => entry.id !== showcaseId),
    [showcaseId, showcases],
  );
  const ownedPercent = levelTotals.total
    ? Math.round((levelTotals.owned / levelTotals.total) * 100)
    : 0;

  const showEmpty = !loading && !loadError && nodes.length === 0;
  const placedCategoryIds = new Set(
    nodes
      .map((node) => node.category_id)
      .filter((categoryId) => categoryId != null),
  );
  const placedCategoryNames = new Set(
    nodes
      .filter((node) => node.node_type === "category")
      .map((node) => String(node.name ?? "").toLowerCase()),
  );
  const availableCategories = categories.filter(
    (category) =>
      !placedCategoryIds.has(category.id) &&
      !placedCategoryNames.has(String(category.name ?? "").toLowerCase()),
  );
  // A category name field is a pool picker, whether it creates or renames; a
  // grouping name field has no pool. Read live so the delete action updates it.
  const nameDialogSuggestions = !nameDialog
    ? []
    : nameDialog.kind === "add-category" ||
        (nameDialog.kind === "rename" &&
          nameDialog.node?.node_type === "category")
      ? availableCategories
      : (nameDialog.suggestions ?? []);
  const reorderEnabled = !filterActive;

  function openReplaceFinder(node) {
    setReplaceNodeId(node.id);
  }

  const gridProps = {
    catalogLayout,
    onAdd: (parent) => openAdd(parent, null, "notes"),
    onAddGroupingAfter: openAddAfter,
    onAddNoteAfter: openAddAfter,
    onAddShellAfter: openAddAfter,
    onClearCover: handleClearCover,
    onEditShell: (node) => setEditShellId(node.id),
    onEditNote: openNoteEditor,
    onOpenGrouping: openNode,
    onOpenNote: openShowcasePreview,
    onOpenShell: openReplaceFinder,
    onReplaceNote: openReplaceFinder,
    onOwnershipToggle: handleOwnershipToggle,
    onPresent: (node) => openPresentation(node.id),
    onRemove: handleRemove,
    onRenameGrouping: openRename,
    onReorder: handleReorder,
    onMove: handleMoveNode,
    onMoveOut: handleMoveOut,
    onMoveInto: (node) => setMoveTargetId(node.id),
    onDragState: handleDragState,
    onSetCover: handleSetCover,
    photoSize,
    reorderEnabled,
  };

  const showcaseActionItems = showcase
    ? [
        {
          key: "rename",
          label: "Rename",
          icon: "edit",
          onSelect: startNameRename,
        },
        {
          key: "delete",
          label: "Delete showcase…",
          icon: "delete",
          danger: true,
          disabled: deleting,
          separated: true,
          onSelect: handleDelete,
        },
      ]
    : [];

  return (
    <section
      className="screen-stack showcase-screen"
      ref={sectionRef}
    >
      <div className="screen-body" inert={editingNote != null}>
        <div className="panel-heading">
          <div className="panel-heading-copy">
            {renamingName ? (
              <form
                className="collection-rename-form"
                onSubmit={submitNameRename}
              >
                <input
                  aria-label="Showcase name"
                  className="showcase-name-field"
                  disabled={savingName}
                  onChange={(event) => {
                    setNameDraft(event.target.value);
                    setNameError("");
                    setActionError("");
                  }}
                  onKeyDown={handleNameKeyDown}
                  ref={nameFieldRef}
                  value={nameDraft}
                />
                <button
                  className="button button-primary"
                  disabled={savingName}
                  title="Save (Enter)"
                  type="submit"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  className="button"
                  disabled={savingName}
                  onClick={cancelNameRename}
                  title="Cancel (Esc)"
                  type="button"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="collection-title-row">
                {showcase ? (
                  <h1 aria-label={showcaseName}>
                    <button
                      aria-label={`Rename showcase: ${showcaseName}`}
                      className="collection-title-button"
                      onClick={startNameRename}
                      ref={nameTitleButtonRef}
                      title="Rename showcase"
                      type="button"
                    >
                      {showcaseName}
                    </button>
                  </h1>
                ) : (
                  <h1>{showcaseName}</h1>
                )}
                {showcase ? (
                  <ActionsMenu
                    items={showcaseActionItems}
                    label="Showcase actions"
                  />
                ) : null}
              </div>
            )}
            {nameError ? (
              <p className="error-text" role="alert">
                {nameError}
              </p>
            ) : null}
          </div>
        </div>

        <p aria-live="polite" className="showcase-announcer" role="status">
          {announcement}
        </p>

        {actionError ? (
          <p className="showcase-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          <p className="muted showcase-empty">Loading showcase…</p>
        ) : null}

        {!loading && loadError ? (
          <div
            className="showcase-empty-box showcase-empty-box--quiet showcase-load-error"
          >
            <div className="showcase-load-error-copy" role="alert">
              <p className="showcase-empty-title">
                Could not load this showcase.
              </p>
              <p className="showcase-empty-text muted">{loadError}</p>
              <p className="showcase-empty-text muted">
                The saved Showcase is untouched. Try the request again.
              </p>
            </div>
            <div className="showcase-empty-actions">
              <button
                className="button button-primary"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {showViewToolbar ? (
          <div className="showcase-filter-bar">
            <div
              aria-label="Card filters"
              className="showcase-filter-chips"
              role="group"
            >
              {CARD_FILTERS.map((filter) => {
                const count =
                  filter.value === "all"
                    ? levelTotals.total
                    : levelTotals[filter.value];

                return (
                  <button
                    aria-label={`${filter.label} (${count})`}
                    aria-pressed={cardFilter === filter.value}
                    className="showcase-filter-chip"
                    data-showcase-filter={filter.value}
                    key={filter.value}
                    onClick={() => setCardFilter(filter.value)}
                    type="button"
                  >
                    <span>{filter.label}</span>
                    <span className="showcase-filter-count">{count}</span>
                  </button>
                );
              })}
            </div>
            {/* The one ownership reading for the level: the chips carry the
                state counts, so the rail adds the owned share and the meter's
                fill. The words come before the bar, so the reading needs no
                hover and no legend. The meter keeps its slot on an empty level
                so the trailing controls never move. */}
            <span className="showcase-filter-progress">
              <span className="showcase-progress-label">
                {`${levelTotals.owned} of ${levelTotals.total} owned`}
              </span>
              <span
                {...meterAria}
                className="showcase-progress"
                title={`${levelTotals.owned} of ${levelTotals.total} owned`}
              >
                <span
                  className="showcase-progress-fill"
                  style={{ width: `${ownedPercent}%` }}
                />
              </span>
              <span aria-hidden="true" className="showcase-progress-pct">
                {`${ownedPercent}%`}
              </span>
              {levelTotals.complete ? (
                <span className="showcase-complete-chip">
                  <span
                    aria-hidden="true"
                    className="showcase-complete-mark"
                  >
                    ✓
                  </span>
                  Complete
                </span>
              ) : null}
            </span>
            <div className="showcase-filter-actions">
              <ShowcaseLayoutControl
                onArrowDown={() => focusCardAt(0)}
                onChange={setCatalogLayout}
                value={catalogLayout}
              />
              <ShowcasePhotoSizeControl
                onArrowDown={() => focusCardAt(0)}
                onChange={setPhotoSize}
                value={photoSize}
              />
              <button
                className="button"
                disabled={!slideshowReady}
                onClick={() => openPresentation()}
                title={slideshowTitle}
                type="button"
              >
                Slideshow
              </button>
            </div>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="showcase-empty-box">
            <p className="showcase-empty-title">This showcase is empty.</p>
            <p className="showcase-empty-text muted">
              Start with a category, then add notes, groupings, and placeholders
              inside it.
            </p>
            <ShowcaseCategoryTile centered onOpen={openAddCategory} />
          </div>
        ) : null}

        {!loading && !loadError && displayNode ? (
          <ShowcaseBreadcrumb
            showcaseName={showcaseName}
            onNavigate={navigateTo}
            path={displayPath}
          />
        ) : null}

        {filterEmpty ? (
          <div className="showcase-empty-box showcase-empty-box--quiet">
            <p className="showcase-empty-title">{activeFilter.emptyTitle}</p>
            <p className="showcase-empty-text muted">{filterEmptyText}</p>
            <div className="showcase-empty-actions">
              <button
                className="button"
                onClick={() => setCardFilter("all")}
                type="button"
              >
                Show all cards
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !loadError && !showEmpty && !filterEmpty ? (
          isRootExpanded ? (
            <>
              {filteredDisplayChildren.map((node) => {
                if (node.node_type !== "category") {
                  return null;
                }

                const rootIndex = nodes.findIndex(
                  (entry) => entry.id === node.id,
                );

                return (
                  <ShowcaseCategorySection
                    canDuplicate={otherShowcases.length > 0}
                    canMoveDown={rootIndex >= 0 && rootIndex < nodes.length - 1}
                    canMoveUp={rootIndex > 0}
                    category={node}
                    key={node.id}
                    {...gridProps}
                    onDuplicate={(target) => setDuplicateSourceId(target.id)}
                    onMoveDown={(target) => handleMoveCategory(target, 1)}
                    onMoveUp={(target) => handleMoveCategory(target, -1)}
                    onRemove={handleRemove}
                    onRename={openRename}
                  />
                );
              })}
              <ShowcaseCategoryTile onOpen={openAddCategory} />
            </>
          ) : (
            <ShowcaseItemsGrid
              items={filteredDisplayChildren}
              parent={displayNode}
              {...gridProps}
            />
          )
        ) : null}
      </div>

      {dragState ? (
        <div className="showcase-drag-dock">
          <p aria-hidden="true" className="showcase-drag-outcome">
            {dragOutcomeLabel(dragState)}
          </p>
          {displayPath.length ? (
            <div
              aria-label="Move to a level"
              className="showcase-drag-levels"
              role="group"
            >
              <span className="showcase-drag-levels-label">Move to</span>
              {displayPath.map((level) => (
                <button
                  className="showcase-drag-level"
                  key={level.id}
                  onDragLeave={(event) =>
                    event.currentTarget.classList.remove("is-target")
                  }
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    event.currentTarget.classList.add("is-target");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.currentTarget.classList.remove("is-target");
                    handleDropAtLevel(level.id);
                  }}
                  title={`Move to the end of ${level.name}`}
                  type="button"
                >
                  {level.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {addTarget ? (
        <ShowcaseAddDialog
          afterId={addTarget.afterId}
          collections={collections}
          initialMode={addTarget.mode}
          onAddGrouping={handleAddGrouping}
          onAddNotes={handleAddNotes}
          onAddShells={handleAddShells}
          onClose={() => setAddTarget(null)}
          parent={addTarget.parent}
        />
      ) : null}

      {replaceNode && (isCatalogEntry(replaceNode) || isNoteNode(replaceNode)) ? (
        <ShowcaseNotePicker
          collections={collections}
          excludeNoteIds={
            isNoteNode(replaceNode) && replaceNode.note_id != null
              ? [replaceNode.note_id]
              : undefined
          }
          node={{
            ...replaceNode,
            name: isCatalogEntry(replaceNode)
              ? catalogEntryIdentity(replaceNode.entry)
              : showcaseNoteTitleParts(replaceNode.note ?? {}).join(" · ") ||
                "note",
          }}
          onAdd={handleReplaceNode}
          onClose={() => setReplaceNodeId(null)}
          singleSelect
        />
      ) : null}

      {duplicateSourceNode ? (
        <ShowcaseDuplicateDialog
          category={duplicateSourceNode}
          onClose={() => setDuplicateSourceId(null)}
          onDuplicate={handleDuplicateCategory}
          showcases={otherShowcases}
        />
      ) : null}

      {nameDialog ? (
        <ShowcaseNameDialog
          initialValue={nameDialog.initialValue}
          label={nameDialog.label}
          onClose={() => setNameDialog(null)}
          onDeleteSuggestion={nameDialog.onDeleteSuggestion}
          onSubmit={submitNameDialog}
          submitLabel={nameDialog.submitLabel}
          subtitle={nameDialog.subtitle}
          suggestions={nameDialogSuggestions}
          suggestionsLabel={nameDialog.suggestionsLabel}
          title={nameDialog.title}
        />
      ) : null}

      {moveTargetNode ? (
        <ShowcaseMoveDialog
          nodes={nodes}
          onClose={() => setMoveTargetId(null)}
          onMove={handleMoveNode}
          source={moveTargetNode}
        />
      ) : null}

      {editShellNode && isCatalogEntry(editShellNode) ? (
        <ShowcaseDialog
          onClose={() => setEditShellId(null)}
          subtitle="Only this planned card's catalog metadata changes."
          title="Edit placeholder"
        >
          <ShowcaseCatalogShellForm
            entry={editShellNode.entry}
            onAdd={handleEditShell}
            onClose={() => setEditShellId(null)}
            submitLabel="Save details"
          />
        </ShowcaseDialog>
      ) : null}

      {presentIndex != null && presentationNotes[presentIndex] ? (
        <Slideshow
          collectionName={showcaseName}
          currentIndex={presentIndex}
          notes={presentationNotes.map((item) => item.note)}
          onChangeIndex={setPresentIndex}
          onClose={closePresentation}
          onJump={(position) => setPresentIndex(position - 1)}
          readOnly
        />
      ) : null}

      {editingNote ? (
        <section className="edit-note-overlay" ref={noteEditorOverlayRef}>
          <div
            className="edit-note-overlay-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <NoteEditForm
              cancelLabel="Close"
              noteId={editingNote.id}
              onCancel={() => guardNoteEditorExit(closeNoteEditor)}
              onDirtyChange={handleNoteEditorDirtyChange}
              onSaveSuccess={handleNoteSaved}
              overlay
              selectedCollectionId={editingNote.collectionId}
              showCounter={false}
              shortcutsDisabled={confirmOpen}
            />
          </div>
        </section>
      ) : null}

      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      {previewOpen && activePreviewItem ? (
        <ImagePopover
          alt={activePreviewItem.alt}
          availableSides={previewItems
            .filter((item) => item.nodeId === activePreviewItem.nodeId)
            .map((item) => item.kind)}
          canGoNext={previewItems.length > 1}
          canGoPrevious={previewItems.length > 1}
          counterPosition={previewIndex + 1}
          counterTotal={previewItems.length}
          noteKey={activePreviewItem.noteId}
          noteLabel={activePreviewItem.noteLabel}
          onClose={closeShowcasePreview}
          onJump={jumpShowcasePreview}
          onNext={() => moveShowcasePreview(1)}
          onPrevious={() => moveShowcasePreview(-1)}
          onPreviewEnd={endShowcasePreview}
          onPreviewStart={startShowcasePreview}
          onSelectSide={selectShowcaseSide}
          side={activePreviewItem.kind}
          src={activePreviewItem.src}
          thumb={activePreviewItem.thumb}
        />
      ) : null}

      {dialog}
    </section>
  );
}

export { ShowcaseScreen };
