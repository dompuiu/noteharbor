import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createShowcaseNode,
  deleteNode,
  getCategories,
  getShowcaseTree,
  reorderNodes,
  updateNode,
} from "../lib/api.js";
import { isEditableElement } from "../lib/editableElement.js";
import { usePhotoSize } from "../lib/photoSize.js";
import {
  DEFAULT_DESTINATION,
  NEW_SHOWCASE_ID,
  SHOWCASE_ROUTES,
  showcaseNodeSearch,
} from "../lib/routes.js";
import {
  appendChildren,
  countNoteNodes,
  findNodeById,
  findNodeIdPath,
  findNodePath,
  removeNodeTree,
  reorderNodeTree,
  updateNodeTree,
  visibleChildNodes,
} from "../lib/showcaseTree.js";
import {
  isTempId,
  makeDraftCategoryNode,
  makeDraftGroupingNode,
  makeDraftNoteNode,
  resetTempIds,
  saveShowcaseDraft,
} from "../lib/showcaseDraft.js";
import { useShowcases } from "../lib/showcases.jsx";
import { useCollections } from "../lib/collections.jsx";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { ShowcaseCategorySection } from "./ShowcaseCategorySection.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseAddTiles } from "./ShowcaseAddTiles.jsx";
import { ShowcaseBreadcrumb } from "./ShowcaseBreadcrumb.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { ShowcasePhotoSizeControl } from "./ShowcasePhotoSizeControl.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode is a draft canvas with Save/Cancel.
// Both share the same shell, grid, and cards so the two never drift.

// The drag handle's accessible name for a note node.
function noteNodeLabel(node) {
  const note = node.note ?? {};
  return (
    [note.denomination, note.issue_date].filter(Boolean).join(" ") || "note"
  );
}

function ShowcaseScreen({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    showcases,
    deleteShowcase,
    renameShowcase,
    createShowcase,
    pendingShowcase,
    beginPendingShowcase,
    discardPendingShowcase,
  } = useShowcases();
  // `new` is the not-yet-saved draft from `+ New showcase`: no server row,
  // no tree load; Save POSTs it, Cancel discards it.
  const isNew = id === NEW_SHOWCASE_ID;
  const showcaseId = isNew ? null : Number(id);
  const showcase = isNew
    ? null
    : (showcases.find((entry) => entry.id === showcaseId) ?? null);
  const showcaseName = isNew
    ? (pendingShowcase?.name ?? "Showcase")
    : (showcase?.name ?? "Showcase");
  const editMode = mode === "edit";
  // Arriving from `+ New showcase` opens the name field focused (and selected)
  // so the user can name the showcase immediately.
  const justCreated = editMode && Boolean(location.state?.justCreated);
  const nameFieldRef = useRef(null);
  const [nameDraft, setNameDraft] = useState(showcaseName);
  const [nameError, setNameError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();
  const { collections } = useCollections();
  // The picker's target node id (not the node object) so the open popup reads
  // the node's current children after an add updates the tree.
  const [pickerNodeId, setPickerNodeId] = useState(null);
  // The photo size is a per-browser preference shared by view and edit mode.
  const [photoSize, setPhotoSize] = usePhotoSize();
  // The shortcut help overlay. `?` opens it; it guards the card shortcuts.
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  // The screen element that owns the card grid; the keyboard listener scopes
  // its card lookup to it so a card on another screen can never be reached.
  const sectionRef = useRef(null);
  // After a drill or a step back, focus the card for this node id when it is on the
  // new level. Null means "do not restore".
  const restoreFocusNodeIdRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [baselineNodes, setBaselineNodes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Edit mode is a draft: every canvas change updates `nodes` only. Save
  // replays the diff to the server; Cancel restores `baselineNodes`.
  const [treeDirty, setTreeDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // The drilled node ids, root first. View mode derives this from the URL
  // below; edit mode keeps it in memory and live-syncs it back to `?node=`
  // (see the sync effect), so both addresses name the same level.
  const [drillIds, setDrillIds] = useState([]);
  // Whether the entry `?node=` has been consumed (or found absent) already;
  // without this the mount effect would fight in-edit drill changes.
  const consumedEditEntryRef = useRef(false);
  // What the polite live region announces on each node entry.
  const [announcement, setAnnouncement] = useState("");
  // `?node=` names the entry drill. View mode derives its drill from it; edit
  // mode adopts it once on mount (the header Edit toggle carries it over so
  // the mode switch lands on the same level).
  const entryNode = new URLSearchParams(location.search).get("node");
  const nodeParam = editMode ? null : entryNode;
  const editEntryNode = editMode ? entryNode : null;

  useEffect(() => {
    setDrillIds([]);
    consumedEditEntryRef.current = false;
  }, [showcaseId, isNew]);

  useEffect(() => {
    if (!justCreated) {
      return;
    }

    const field = nameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [justCreated]);

  // The heading and the sidebar both read the provider's row, so a rename is
  // reflected everywhere from one applied server row. Keep the local draft in
  // step with it (a list load can arrive after the first render, and a saved
  // rename normalises whitespace), but never clobber text the user is typing.
  useEffect(() => {
    if (document.activeElement === nameFieldRef.current) {
      return;
    }

    setNameDraft(showcaseName);
  }, [showcaseName]);

  // A direct load of the draft URL (reload, share) has no provider draft yet;
  // stage one so the sidebar row and the canvas agree.
  useEffect(() => {
    if (isNew && !pendingShowcase) {
      beginPendingShowcase();
    }
  }, [isNew, pendingShowcase, beginPendingShowcase]);

  useEffect(() => {
    let active = true;

    // The draft has no server tree: start empty and load only the label pool.
    if (isNew) {
      setLoading(true);
      setLoadError("");

      async function loadDraftPool() {
        try {
          const pool = editMode
            ? await getCategories()
            : { categories: [] };

          if (!active) {
            return;
          }

          setNodes([]);
          setBaselineNodes([]);
          setCategories(pool.categories ?? []);
          setTreeDirty(false);
          setSaveError("");
          resetTempIds();
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

      loadDraftPool();
      return () => {
        active = false;
      };
    }

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
          editMode ? getCategories() : Promise.resolve({ categories: [] }),
        ]);

        if (!active) {
          return;
        }

        setNodes(tree.nodes ?? []);
        setBaselineNodes(tree.nodes ?? []);
        setCategories(pool.categories ?? []);
        setTreeDirty(false);
        setSaveError("");
        resetTempIds();
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
  }, [showcaseId, editMode, isNew]);

  // In edit mode the name field is part of the draft: blur/Enter only validate
  // locally, and Save persists the rename together with the tree.
  function commitName() {
    if (!showcase && !isNew) {
      return;
    }

    const trimmed = nameDraft.trim();

    if (!trimmed) {
      setNameError("A showcase name is required.");
      return;
    }

    const currentName = isNew
      ? (pendingShowcase?.name ?? "Showcase")
      : showcase.name;

    if (trimmed === currentName) {
      setNameDraft(currentName);
      setNameError("");
      return;
    }

    setNameDraft(trimmed);
    setNameError("");
  }

  function handleNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
      event.currentTarget?.blur?.();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // A new showcase starts with the name field focused: Escape bails out
      // of the whole draft, exactly like Cancel, instead of only reverting
      // the field.
      if (isNew) {
        handleCancel();
        return;
      }
      setNameDraft(showcase?.name ?? "Showcase");
      setNameError("");
    }
  }

  const nameDirty =
    editMode && !isNew && showcase
      ? nameDraft.trim() !== "" && nameDraft.trim() !== showcase.name
      : false;
  // A draft showcase is itself unsaved, so Save stays enabled whenever the
  // name is non-empty — even with an empty canvas.
  const dirty = editMode && (isNew ? nameDraft.trim() !== "" : treeDirty || nameDirty);

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
        navigate(SHOWCASE_ROUTES.showcaseEdit(nextShowcaseId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  // Edit mode is a draft: adds/renames/removes only touch `nodes`. Save
  // replays the diff; nothing here calls the network.
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
    const draft = makeDraftCategoryNode({
      name: match ? match.name : trimmed,
      categoryId: match ? match.id : null,
    });
    setNodes((current) => [...current, draft]);
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleRenameCategory(node, name) {
    const trimmed = String(name ?? "").trim();
    setNodes((current) =>
      updateNodeTree(current, node.id, (entry) => ({
        ...entry,
        name: trimmed,
        _pendingCategoryName:
          isTempId(entry.id) && entry.category_id == null ? trimmed : entry._pendingCategoryName ?? null,
      })),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleRemoveCategory(node) {
    setNodes((current) => current.filter((entry) => entry.id !== node.id));
    // A removed drill level falls back to the root.
    setDrillIds((current) => current.filter((id) => id !== node.id));
    setTreeDirty(true);
    setSaveError("");
  }

  // Arrow reorder for top-level categories (many items make drag impractical).
  // Draft only: swap the placement with its neighbour and persist on Save.
  function handleMoveCategory(node, direction) {
    setNodes((current) => {
      const index = current.findIndex((entry) => entry.id === node.id);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const orderedIds = current.map((entry) => entry.id);
      [orderedIds[index], orderedIds[nextIndex]] = [
        orderedIds[nextIndex],
        orderedIds[index],
      ];

      return reorderNodeTree(current, null, orderedIds);
    });
    setTreeDirty(true);
    setSaveError("");
  }

  // View mode is URL-synced: `?node=<id>` names the current node and the root
  // has no parameter. Edit mode keeps the drill in memory.
  const urlDrillIds =
    !editMode && nodeParam ? findNodeIdPath(nodes, Number(nodeParam)) : [];
  const effectiveDrillIds = editMode ? drillIds : urlDrillIds;
  // The current drill level. `currentParentId` is the node a new Grouping is
  // created under (null at the top level, where only Categories live).
  const currentPath = findNodePath(nodes, effectiveDrillIds);
  const currentNode = currentPath.length
    ? currentPath[currentPath.length - 1]
    : null;
  const currentParentId = currentNode ? currentNode.id : null;
  const currentChildren = currentNode ? (currentNode.children ?? []) : nodes;

  // Categories always render expanded at the root, so a drill that lands on a
  // Category (an old `?node=<categoryId>` link, or an edit drill from before)
  // is shown as the expanded root instead of a single-category level.
  const displayNode =
    currentNode?.node_type === "category" ? null : currentNode;
  const displayPath = displayNode ? currentPath : [];
  const displayChildren = displayNode
    ? (displayNode.children ?? [])
    : nodes;
  const isRootExpanded = displayNode == null;
  // View mode hides empty Categories (no notes anywhere beneath them) so the
  // presentation never shows an empty section; edit mode keeps them so they
  // can be filled.
  const visibleRootNodes =
    isRootExpanded && !editMode
      ? nodes.filter((node) =>
          node.node_type !== "category"
            ? true
            : countNoteNodes([node]) > 0,
        )
      : nodes;
  const rootCategories = visibleRootNodes.filter(
    (node) => node.node_type === "category",
  );
  const showCategoryMove = editMode && rootCategories.length > 1;

  // A `?node=` that no longer resolves (a node removed in another tab, or a
  // stale deep link) falls back to the root and drops the parameter.
  useEffect(() => {
    if (editMode || loading || !nodeParam) {
      return;
    }

    if (findNodeIdPath(nodes, Number(nodeParam)).length === 0) {
      navigate({ search: "" }, { replace: true });
    }
  }, [editMode, loading, navigate, nodeParam, nodes]);

  // Edit mode adopts the entry `?node=` into the in-memory drill once the tree
  // loads (the header Edit toggle carries it over; a drilled edit URL also
  // restores on reload or share). The sync effect below keeps the address
  // naming the level from then on.
  useEffect(() => {
    if (!editMode || loading || consumedEditEntryRef.current) {
      return;
    }

    consumedEditEntryRef.current = true;

    if (editEntryNode == null) {
      return;
    }

    const entryPath = findNodeIdPath(nodes, Number(editEntryNode));

    if (entryPath.length) {
      setDrillIds(entryPath);
    }
  }, [editEntryNode, editMode, loading, nodes]);
  // Announce each node entry through a polite live region; the root announces
  // the showcase itself.
  // View mode hides empty Groupings (no notes beneath them); edit mode keeps
  // them so they can be filled.
  const visibleDisplayChildren = visibleChildNodes(displayChildren, editMode);
  const announcedCount = isRootExpanded ? visibleRootNodes.length : visibleDisplayChildren.length;
  useEffect(() => {
    if (loading) {
      return;
    }

    const name = displayNode ? displayNode.name : showcaseName;
    setAnnouncement(`${name}, ${announcedCount} items`);
  }, [announcedCount, displayNode, loading, showcaseName]);

  // Dragging a note or a Grouping reorders it among the current level's
  // children, so notes and groupings share one order. Categories only exist at
  // the top level and are not draggable here (the sidebar owns showcase order).
  // The expanded root gives each Category section its own reorder state; this
  // hook serves the drilled Grouping level.
  const reorder = useShowcaseReorder({
    nodes: currentChildren,
    onReorder: handleReorderChildren,
  });

  async function handleReorderChildren(orderedIds) {
    handleReorderChildrenFor(currentParentId, orderedIds);
  }

  function handleReorderChildrenFor(parentId, orderedIds) {
    // Draft only: the order persists on Save.
    setNodes((current) =>
      reorderNodeTree(current, parentId, orderedIds),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  function openNode(node) {
    // Categories always render expanded, so they never drill. Groupings still
    // open into their own level.
    if (node?.node_type === "category") {
      return;
    }

    // Focus the card we leave from when it is on the new level (it is not, for
    // a drill, but a step back to this level restores it).
    restoreFocusNodeIdRef.current = node.id;

    if (editMode) {
      setDrillIds(findNodeIdPath(nodes, node.id));
      return;
    }

    navigate({ search: showcaseNodeSearch(node.id) });
  }

  // `-1` is the Showcase root; any other index opens that breadcrumb level.
  // A Category never has its own level (it renders expanded), so navigating to
  // one lands on the root instead of a `?node=<categoryId>` URL.
  function navigateTo(targetIndex) {
    // Going up or sideways restores focus to the node we are leaving when its
    // card is on the destination level.
    restoreFocusNodeIdRef.current = displayNode?.id ?? null;

    if (editMode) {
      setDrillIds((current) => {
        const next =
          targetIndex < 0 ? [] : current.slice(0, targetIndex + 1);

        while (next.length) {
          const last = findNodeById(nodes, next[next.length - 1]);

          if (last?.node_type === "category") {
            next.pop();
            continue;
          }

          break;
        }

        return next;
      });
      return;
    }

    const rawTargetId =
      targetIndex < 0 ? null : (effectiveDrillIds[targetIndex] ?? null);
    const target =
      rawTargetId == null ? null : findNodeById(nodes, rawTargetId);
    const targetId =
      target?.node_type === "category" ? null : rawTargetId;
    navigate({ search: showcaseNodeSearch(targetId) });
  }

  async function handleAddGrouping(name) {
    handleAddGroupingFor(currentParentId, name);
  }

  // The per-category add tile in the expanded root passes its own parent id;
  // the drilled grouping level passes the current drill parent.
  function handleAddGroupingFor(parentId, name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || parentId == null) {
      return;
    }
    const draft = makeDraftGroupingNode({ name: trimmed, parentId });
    setNodes((current) =>
      updateNodeTree(current, parentId, (parent) => ({
        ...parent,
        children: [...(parent.children ?? []), draft],
      })),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleRenameGrouping(node, name) {
    const trimmed = String(name ?? "").trim();
    setNodes((current) =>
      updateNodeTree(current, node.id, (entry) => ({
        ...entry,
        name: trimmed,
        children: entry.children,
      })),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleRemoveGrouping(node) {
    setNodes((current) => removeNodeTree(current, node.id));
    setDrillIds((current) => current.filter((id) => id !== node.id));
    setTreeDirty(true);
    setSaveError("");
  }

  function handleOpenNotePicker(node) {
    setPickerNodeId(node.id);
  }

  // Draft only: stage note nodes under the picker target. The picker passes
  // its loaded notes so the cards render before Save.
  async function handleAddNotes(noteIds, allNotes = []) {
    if (pickerNodeId == null) {
      return;
    }
    const byId = new Map((allNotes ?? []).map((note) => [note.id, note]));
    const drafts = (noteIds ?? []).map((noteId) =>
      makeDraftNoteNode({
        note: byId.get(noteId) ?? { id: noteId },
        parentId: pickerNodeId,
      }),
    );
    if (!drafts.length) {
      return;
    }
    setNodes((current) => appendChildren(current, pickerNodeId, drafts));
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleRemoveNote(noteNode) {
    setNodes((current) => removeNodeTree(current, noteNode.id));
    setTreeDirty(true);
    setSaveError("");
  }

  // Set the current Grouping's manual cover to a direct-child note (user story
  // 37). Draft only: the cover persists on Save.
  function handleSetCover(noteNode) {
    if (!displayNode || displayNode.node_type !== "grouping") {
      return;
    }

    const coverNoteId = noteNode.note_id ?? noteNode.note?.id ?? null;
    setNodes((current) =>
      updateNodeTree(current, displayNode.id, (entry) => ({
        ...entry,
        cover_note_id: coverNoteId,
        cover_note: noteNode.note ?? entry.cover_note,
        children: entry.children,
      })),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  // Clearing returns the Grouping to its derived cover (ticket 09).
  function handleClearCover() {
    if (!displayNode || displayNode.node_type !== "grouping") {
      return;
    }

    setNodes((current) =>
      updateNodeTree(current, displayNode.id, (entry) => ({
        ...entry,
        cover_note_id: null,
        cover_note: null,
        children: entry.children,
      })),
    );
    setTreeDirty(true);
    setSaveError("");
  }

  async function handleSave() {
    if (!editMode || saving || loading) {
      return;
    }
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setNameError("A showcase name is required.");
      return;
    }
    // Preserve the drilled level across the save when it is a saved node;
    // staged (temporary) levels fall back to the root.
    const savedDisplayId =
      displayNode && !isTempId(displayNode.id) ? displayNode.id : null;
    setSaving(true);
    setSaveError("");
    setNameError("");
    try {
      if (isNew) {
        // Deferred creation: the POST happens here, not on `+ New showcase`.
        // An untouched "Showcase" name omits the name so the server picks a
        // unique default instead of hitting the duplicate-name error.
        const created = await createShowcase(
          trimmedName === "Showcase" ? undefined : trimmedName,
        );
        if (created?.id == null) {
          throw new Error("Could not save the showcase.");
        }
        await saveShowcaseDraft({
          showcaseId: created.id,
          baselineNodes: [],
          draftNodes: nodes,
          api: { createShowcaseNode, updateNode, deleteNode, reorderNodes },
        });
        // createShowcase clears the pending draft; land on the real view.
        navigate({
          pathname: SHOWCASE_ROUTES.showcase(created.id),
          search: showcaseNodeSearch(savedDisplayId),
        });
        return;
      }
      if (showcase && trimmedName !== showcase.name) {
        await renameShowcase(showcase.id, trimmedName);
      }
      await saveShowcaseDraft({
        showcaseId,
        baselineNodes,
        draftNodes: nodes,
        api: { createShowcaseNode, updateNode, deleteNode, reorderNodes },
      });
      // The mode switch remounts the screen (see the route keys), so view
      // loads the saved tree fresh; no local reset is needed here.
      navigate({
        pathname: SHOWCASE_ROUTES.showcase(showcaseId),
        search: showcaseNodeSearch(savedDisplayId),
      });
    } catch (error) {
      setSaveError(error.message || "Could not save the showcase.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (saving) {
      return;
    }
    // A draft showcase has no view to return to: discard it and land on the
    // last showcase in the list (or home when the list is empty) so the
    // sidebar row disappears with it.
    if (isNew) {
      discardPendingShowcase();
      const lastShowcase = showcases[showcases.length - 1] ?? null;
      navigate(
        lastShowcase
          ? SHOWCASE_ROUTES.showcase(lastShowcase.id)
          : DEFAULT_DESTINATION,
      );
      return;
    }
    // Cancel discards the draft and returns to view on the same level when
    // it is a saved node. The mode switch remounts the screen (see the route
    // keys), so no local reset is needed: the draft state is discarded with
    // the edit instance and view loads fresh from the entry `?node=`.
    const cancelDisplayId =
      displayNode && !isTempId(displayNode.id) ? displayNode.id : null;
    navigate({
      pathname: SHOWCASE_ROUTES.showcase(showcaseId),
      search: showcaseNodeSearch(cancelDisplayId),
    });
  }

  // --- Keyboard navigation ------------------------------------------------
  // The number of levels deep the canvas is drilled. The Escape step uses it to
  // decide whether there is a level to go up to.
  const drillDepth = effectiveDrillIds.length;

  // Every card is a `.showcase-card`, and DOM order is the grid's reading
  // order. All cards carry `tabIndex={0}` (no roving tabindex); the shortcuts
  // only move `document.activeElement`.
  function showcaseCardElements() {
    const root = sectionRef.current;

    if (!root) {
      return [];
    }

    return Array.from(root.querySelectorAll(".showcase-card"));
  }

  // The card under focus, or the card of the cell the focused control sits in
  // (a Rename/Remove/Reorder control belongs to the card's own cell).
  function focusedShowcaseCard() {
    const active = document.activeElement;

    if (!(active instanceof Element) || !sectionRef.current?.contains(active)) {
      return null;
    }

    return (
      active.closest(".showcase-card") ??
      active.closest(".showcase-cell")?.querySelector(".showcase-card") ??
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

  // How many cards a page step covers: the columns on the first row times the
  // rows a viewport holds. Measured from the rendered cards; a layout that
  // cannot be measured falls back to one row.
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

  // One window listener drives card navigation and the edit actions, mirroring
  // the Banknotes table. Guards, in order: an open dialog, a text field, the
  // sidebar, and a Meta/Ctrl/Alt chord.
  useEffect(() => {
    function handleGlobalKeyDown(event) {
      if (showShortcutsHelp || pickerNodeId != null || confirmOpen) {
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

      if (event.key === "Enter" || event.key === " ") {
        // Grouping and note cards are native buttons in both modes, so
        // Enter/Space activate through the button itself. No manual handling
        // here, otherwise a card would open or toggle twice.
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
        return;
      }

      // Edit mode's single-key actions act on the focused card: `a` opens the
      // note picker for that card's node (a Category or Grouping; a note cannot
      // hold notes), `e` its rename field, `d` its remove control. `g` is the
      // current level's add-grouping tile, which is not inside a cell.
      if (
        editMode &&
        (event.key === "a" ||
          event.key === "g" ||
          event.key === "e" ||
          event.key === "d")
      ) {
        const card = focusedShowcaseCard();

        if (!card) {
          return;
        }

        event.preventDefault();
        const cell = card.closest(".showcase-cell");

        if (event.key === "a") {
          const nodeId =
            card.dataset?.showcaseNodeId != null
              ? Number(card.dataset.showcaseNodeId)
              : null;
          const node = Number.isInteger(nodeId)
            ? findNodeById(nodes, nodeId)
            : null;

          if (node && node.node_type !== "note") {
            setPickerNodeId(node.id);
          }

          return;
        }

        if (event.key === "g") {
          sectionRef.current
            ?.querySelector('[aria-label="Add grouping"]')
            ?.click();
          return;
        }

        const action = event.key === "e" ? "rename" : "remove";
        cell?.querySelector(`[data-showcase-action="${action}"]`)?.click();
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    confirmOpen,
    drillDepth,
    editMode,
    nodes,
    pickerNodeId,
    showShortcutsHelp,
  ]);

  // After a drill or a step back, bring focus back to the card for the node we left
  // when it is on the new level. A card that is no longer rendered is skipped,
  // so a drill into a node simply leaves focus unfocused.
  const drillKey = effectiveDrillIds.join("/");

  // Edit mode live-syncs the in-memory drill to `?node=` so the address always
  // names the current level. Staged (unsaved) nodes have temporary ids and are
  // never written to the URL.
  const editDrillSearch = showcaseNodeSearch(
    displayNode && !isTempId(displayNode.id) ? displayNode.id : null,
  );

  useEffect(() => {
    if (!editMode || loading) {
      return;
    }

    if (location.search !== editDrillSearch) {
      navigate({ search: editDrillSearch }, { replace: true });
    }
  }, [editDrillSearch, editMode, loading, location.search, navigate]);

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

  const pickerNode =
    pickerNodeId == null ? null : findNodeById(nodes, pickerNodeId);

  const showEmpty = !loading && !loadError && nodes.length === 0;
  // Both modes share the dashed empty-state box so view mode never reads as
  // a missing string; edit mode adds the create tile, view mode a hint plus
  // a way forward.
  const showViewEmpty = showEmpty && !editMode;
  const showEditEmpty = showEmpty && editMode;
  // A resolvable node with nothing visible under it is not the same as an
  // empty showcase: a Grouping holding only non-empty sub-Groupings is not
  // empty. Categories render expanded with their own per-section empty copy,
  // so this only covers a drilled Grouping. In view mode empty Groupings are
  // hidden, so the empty state reads the visible children, not the raw ones.
  const showEmptyNode =
    !loading &&
    !loadError &&
    displayNode != null &&
    visibleDisplayChildren.length === 0;
  const showViewEmptyNode = showEmptyNode && !editMode;
  // A label can be placed at most once per Showcase, so do not suggest the ones
  // already on the canvas (including staged draft placements by name).
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
  // The header's muted total (presentation spec §1): the loaded tree's note
  // count, or the showcase row's count until the tree arrives.
  const noteCount = loading
    ? (showcase?.note_count ?? 0)
    : countNoteNodes(nodes);

  return (
    <section
      className={`screen-stack showcase-screen showcase-screen--${editMode ? "edit" : "view"}`}
      ref={sectionRef}
    >
      <div className="panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            {editMode ? (
              <input
                aria-label="Showcase name"
                className="showcase-name-field"
                onBlur={commitName}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameError("");
                  setSaveError("");
                }}
                onKeyDown={handleNameKeyDown}
                ref={nameFieldRef}
                value={nameDraft}
              />
            ) : (
              <h1>{showcaseName}</h1>
            )}
            <p className="muted showcase-note-count">{`${noteCount} notes`}</p>
            {editMode && dirty && !loading ? (
              <p className="muted showcase-dirty">Unsaved changes</p>
            ) : null}
          </div>
          <div className="showcase-header-controls">
            <div className="showcase-photo-size">
              <ShowcasePhotoSizeControl
                onChange={setPhotoSize}
                value={photoSize}
              />
            </div>
            <div className="panel-heading-actions">
              {/* Edit mode is a draft: Save persists the canvas and the name,
              Cancel discards both and returns to view. */}
              {editMode ? (
                <>
                  {showcase ? (
                    <button
                      className="button button-danger"
                      disabled={deleting}
                      onClick={handleDelete}
                      type="button"
                    >
                      Delete showcase
                    </button>
                  ) : null}
                  <button
                    className="button"
                    disabled={saving}
                    onClick={handleCancel}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    disabled={!dirty || saving || loading}
                    onClick={handleSave}
                    type="button"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <Link
                  className="button"
                  to={{
                    pathname: SHOWCASE_ROUTES.showcaseEdit(showcaseId),
                    search: location.search,
                  }}
                >
                  Edit
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Politeness only: the current level is announced on every entry. */}
        <p aria-live="polite" className="showcase-announcer" role="status">
          {announcement}
        </p>

        {nameError ? (
          <p className="muted showcase-name-error" role="alert">
            {nameError}
          </p>
        ) : null}

        {saveError ? (
          <p className="showcase-error" role="alert">
            {saveError}
          </p>
        ) : null}

        {loading ? (
          <p className="muted showcase-empty">Loading showcase…</p>
        ) : null}

        {!loading && loadError ? (
          <p className="showcase-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {showViewEmpty ? (
          <div className="showcase-empty-box">
            <svg
              aria-hidden="true"
              className="showcase-empty-art"
              focusable="false"
              height="48"
              viewBox="0 0 48 48"
              width="48"
            >
              <rect
                height="26"
                rx="3"
                width="30"
                x="9"
                y="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <rect
                height="26"
                rx="3"
                width="30"
                x="13"
                y="9"
                fill="var(--surface)"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="20" cy="17" fill="currentColor" r="2" />
              <path
                d="M15 29 L22 22 L27 27 L30 24 L35 29 Z"
                fill="none"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            <p className="showcase-empty-title">This showcase is empty.</p>
            <p className="showcase-empty-text muted">
              Nothing to present yet. Add categories, groupings, and notes in
              edit mode to start the story.
            </p>
            <div className="showcase-empty-actions">
              <Link
                className="button"
                to={SHOWCASE_ROUTES.showcaseEdit(showcaseId)}
              >
                Edit showcase
              </Link>
            </div>
          </div>
        ) : null}

        {showEditEmpty ? (
          <div className="showcase-empty-box">
            <p className="showcase-empty-text">
              No categories yet. Reuse a label or create a new one.
            </p>
            <ShowcaseCategoryTile
              categories={availableCategories}
              centered
              onAdd={handleAddCategory}
            />
          </div>
        ) : null}

        {showViewEmptyNode ? (
          <div className="showcase-empty-box">
            <p className="showcase-empty-title">No notes here yet.</p>
            <p className="showcase-empty-text muted">
              This level has nothing to present yet. Check back later or add
              notes to it in edit mode.
            </p>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <>
            {displayNode ? (
              <ShowcaseBreadcrumb
                showcaseName={showcaseName}
                onNavigate={navigateTo}
                path={displayPath}
              />
            ) : null}

            {editMode && displayNode?.node_type === "grouping" ? (
              <div className="showcase-node-cover">
                <span className="muted">
                  {displayNode.cover_note_id != null
                    ? "Cover set by hand."
                    : "Cover derives from the first note."}
                </span>
                {displayNode.cover_note_id != null ? (
                  <button
                    className="button"
                    onClick={handleClearCover}
                    type="button"
                  >
                    Clear cover
                  </button>
                ) : null}
              </div>
            ) : null}

            {isRootExpanded ? (
              <>
                {visibleRootNodes.map((node) => {
                  if (node.node_type !== "category") {
                    return null;
                  }

                  const categoryIndex = rootCategories.findIndex(
                    (entry) => entry.id === node.id,
                  );

                  return (
                    <ShowcaseCategorySection
                      category={node}
                      editMode={editMode}
                      key={node.id}
                      onAddGrouping={handleAddGroupingFor}
                      onAddNotes={handleOpenNotePicker}
                      onOpenGrouping={openNode}
                      onRemoveCategory={handleRemoveCategory}
                      onRemoveGrouping={handleRemoveGrouping}
                      onRemoveNote={handleRemoveNote}
                      onRenameCategory={handleRenameCategory}
                      onRenameGrouping={handleRenameGrouping}
                      onReorder={handleReorderChildrenFor}
                      onMoveCategory={
                        showCategoryMove ? handleMoveCategory : undefined
                      }
                      canMoveUp={showCategoryMove && categoryIndex > 0}
                      canMoveDown={
                        showCategoryMove &&
                        categoryIndex < rootCategories.length - 1
                      }
                      photoSize={photoSize}
                    />
                  );
                })}

                {editMode && !showEditEmpty ? (
                  <ShowcaseCategoryTile
                    categories={availableCategories}
                    onAdd={handleAddCategory}
                  />
                ) : null}
              </>
            ) : (
              <ShowcaseGrid size={photoSize}>
                {visibleDisplayChildren.map((node) => {
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
                          onOpen={() => openNode(node)}
                          onRemove={handleRemoveGrouping}
                          onRename={handleRenameGrouping}
                        />
                      </ShowcaseReorderableCell>
                    ) : (
                      <ShowcaseGroupingCard
                        key={node.id}
                        node={node}
                        onOpen={() => openNode(node)}
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
                        <ShowcaseNoteEditor
                          node={node}
                          onRemove={handleRemoveNote}
                          onSetCover={
                            displayNode?.node_type === "grouping"
                              ? handleSetCover
                              : undefined
                          }
                        />
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

                {editMode && displayNode ? (
                  <ShowcaseAddTiles
                    onAddGrouping={handleAddGrouping}
                    onAddNotes={() => handleOpenNotePicker(displayNode)}
                  />
                ) : null}
              </ShowcaseGrid>
            )}
          </>
        ) : null}
      </div>

      {pickerNode ? (
        <ShowcaseNotePicker
          collections={collections}
          node={pickerNode}
          onAdd={handleAddNotes}
          onClose={() => setPickerNodeId(null)}
        />
      ) : null}

      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      {dialog}
    </section>
  );
}

export { ShowcaseScreen };
