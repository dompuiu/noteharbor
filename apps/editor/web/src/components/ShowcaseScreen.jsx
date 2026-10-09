import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createCategory,
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
} from "../lib/showcaseTree.js";
import { useShowcases } from "../lib/showcases.jsx";
import { useCollections } from "../lib/collections.jsx";
import { useShowcaseReorder } from "../lib/showcaseReorder.jsx";
import { ShowcaseCategoryCard } from "./ShowcaseCategoryCard.jsx";
import { ShowcaseCategoryEditor } from "./ShowcaseCategoryEditor.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseBreadcrumb } from "./ShowcaseBreadcrumb.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";
import { ShowcaseGroupingTile } from "./ShowcaseGroupingTile.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { ShowcaseNoteTile } from "./ShowcaseNoteTile.jsx";
import { ShowcasePhotoSizeControl } from "./ShowcasePhotoSizeControl.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell, grid, and cards so the two never drift. Categories sit at the top
// level; a Category or Grouping opens into its own level (nothing expands
// inline — ticket 09 / user story 41), and edit mode drills one level at a time
// exactly like view mode, with the drill kept in memory.
function upsertCategory(categories, category) {
  const others = categories.filter((entry) => entry.id !== category.id);
  return [...others, category].sort((a, b) => a.name.localeCompare(b.name));
}

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
  const { showcases, deleteShowcase, renameShowcase } = useShowcases();
  const showcaseId = Number(id);
  const showcase = showcases.find((entry) => entry.id === showcaseId) ?? null;
  const showcaseName = showcase?.name ?? "Showcase";
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
  // After a drill or an Up, focus the card for this node id when it is on the
  // new level. Null means "do not restore".
  const restoreFocusNodeIdRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // The drilled node ids, root first. Edit mode keeps this in memory (the URL
  // does not change during edits); view mode derives it from the URL below.
  const [drillIds, setDrillIds] = useState([]);
  // What the polite live region announces on each node entry.
  const [announcement, setAnnouncement] = useState("");
  const nodeParam = editMode
    ? null
    : new URLSearchParams(location.search).get("node");

  useEffect(() => {
    setDrillIds([]);
  }, [showcaseId]);

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
          editMode ? getCategories() : Promise.resolve({ categories: [] }),
        ]);

        if (!active) {
          return;
        }

        setNodes(tree.nodes ?? []);
        setCategories(pool.categories ?? []);
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
  }, [showcaseId, editMode]);

  async function commitName() {
    if (!showcase) {
      return;
    }

    const trimmed = nameDraft.trim();

    if (!trimmed) {
      setNameDraft(showcase.name);
      setNameError("A showcase name is required.");
      return;
    }

    if (trimmed === showcase.name) {
      setNameDraft(showcase.name);
      setNameError("");
      return;
    }

    try {
      await renameShowcase(showcase.id, trimmed);
      setNameError("");
    } catch (error) {
      setNameError(error.message);
      setNameDraft(showcase.name);
    }
  }

  function handleNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setNameDraft(showcaseName);
      setNameError("");
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
        navigate(SHOWCASE_ROUTES.showcaseEdit(nextShowcaseId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  // The label is get-or-create, so a typed name that matches an existing label
  // reuses it; the returned label id is what the placement references.
  async function handleAddCategory(name) {
    const { category } = await createCategory(name);
    const { node } = await createShowcaseNode(showcaseId, {
      type: "category",
      category_id: category.id,
    });

    if (node) {
      setNodes((current) => [...current, node]);
    }

    if (category) {
      setCategories((current) => upsertCategory(current, category));
    }
  }

  // Renaming a Placement renames the shared label, so keep the local card in
  // step with the name the user chose.
  async function handleRenameCategory(node, name) {
    const { node: updated } = await updateNode(node.id, { name });

    setNodes((current) =>
      current.map((entry) =>
        entry.id === node.id ? { ...entry, ...(updated ?? {}), name } : entry,
      ),
    );
  }

  async function handleRemoveCategory(node) {
    await deleteNode(node.id);
    setNodes((current) => current.filter((entry) => entry.id !== node.id));
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

  // Announce each node entry through a polite live region; the root announces
  // the showcase itself.
  useEffect(() => {
    if (loading) {
      return;
    }

    const name = currentNode ? currentNode.name : showcaseName;
    setAnnouncement(`${name}, ${currentChildren.length} items`);
  }, [currentChildren.length, currentNode, loading, showcaseName]);

  // Dragging a note or a Grouping reorders it among the current level's
  // children, so notes and groupings share one order. Categories only exist at
  // the top level and are not draggable here (the sidebar owns showcase order).
  const reorder = useShowcaseReorder({
    nodes: currentChildren,
    onReorder: handleReorderChildren,
  });

  async function handleReorderChildren(orderedIds) {
    // Persist first, then reorder locally: a rejected request leaves the
    // visible order untouched.
    await reorderNodes(showcaseId, currentParentId, orderedIds);
    setNodes((current) =>
      reorderNodeTree(current, currentParentId, orderedIds),
    );
  }

  function openNode(node) {
    // Focus the card we leave from when it is on the new level (it is not, for
    // a drill, but an Up back to this level restores it).
    restoreFocusNodeIdRef.current = node.id;

    if (editMode) {
      setDrillIds((current) => [...current, node.id]);
      return;
    }

    navigate({ search: showcaseNodeSearch(node.id) });
  }

  // `-1` is the Showcase root; any other index opens that breadcrumb level.
  function navigateTo(targetIndex) {
    // Going up or sideways restores focus to the node we are leaving when its
    // card is on the destination level.
    restoreFocusNodeIdRef.current = currentNode?.id ?? null;

    if (editMode) {
      setDrillIds((current) =>
        targetIndex < 0 ? [] : current.slice(0, targetIndex + 1),
      );
      return;
    }

    const targetId =
      targetIndex < 0 ? null : (effectiveDrillIds[targetIndex] ?? null);
    navigate({ search: showcaseNodeSearch(targetId) });
  }

  async function handleAddGrouping(name) {
    const { node } = await createShowcaseNode(showcaseId, {
      type: "grouping",
      parent_id: currentParentId,
      name,
    });

    if (node) {
      setNodes((current) =>
        updateNodeTree(current, currentParentId, (parent) => ({
          ...parent,
          children: [...(parent.children ?? []), node],
        })),
      );
    }
  }

  async function handleRenameGrouping(node, name) {
    const { node: updated } = await updateNode(node.id, { name });

    setNodes((current) =>
      updateNodeTree(current, node.id, (entry) => ({
        ...entry,
        ...(updated ?? {}),
        name,
        // The server's single-node row has no children; keep the local subtree.
        children: entry.children,
      })),
    );
  }

  async function handleRemoveGrouping(node) {
    await deleteNode(node.id);
    setNodes((current) => removeNodeTree(current, node.id));
  }

  function handleOpenNotePicker(node) {
    setPickerNodeId(node.id);
  }

  // The notes batch returns every new node, so append them under the target in
  // the given order without refetching the tree (mirrors the category add).
  async function handleAddNotes(noteIds) {
    if (pickerNodeId == null) {
      return;
    }

    const { nodes: added } = await createShowcaseNode(showcaseId, {
      type: "notes",
      parent_id: pickerNodeId,
      note_ids: noteIds,
    });

    if (added?.length) {
      setNodes((current) => appendChildren(current, pickerNodeId, added));
    }
  }

  async function handleRemoveNote(noteNode) {
    await deleteNode(noteNode.id);
    setNodes((current) => removeNodeTree(current, noteNode.id));
  }

  // Set the current Grouping's manual cover to a direct-child note (user story
  // 37). The server answers with the updated node; splice it into the tree so
  // `cover_note` (and the card's cover) reflects the choice without a refetch.
  async function handleSetCover(noteNode) {
    if (!currentNode || currentNode.node_type !== "grouping") {
      return;
    }

    const coverNoteId = noteNode.note_id ?? noteNode.note?.id ?? null;
    const { node: updated } = await updateNode(currentNode.id, {
      cover_note_id: coverNoteId,
    });

    setNodes((current) =>
      updateNodeTree(current, currentNode.id, (entry) => ({
        ...entry,
        ...(updated ?? {}),
        // The server's single-node row has no children; keep the local subtree.
        children: entry.children,
      })),
    );
  }

  // Clearing returns the Grouping to its derived cover (ticket 09).
  async function handleClearCover() {
    if (!currentNode || currentNode.node_type !== "grouping") {
      return;
    }

    const { node: updated } = await updateNode(currentNode.id, {
      cover_note_id: null,
    });

    setNodes((current) =>
      updateNodeTree(current, currentNode.id, (entry) => ({
        ...entry,
        ...(updated ?? {}),
        children: entry.children,
      })),
    );
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

  // The card element itself is focused (not merely a control inside its cell).
  // Enter/Space defer to the native button, so this must not treat a focused
  // Rename/Remove button as its card.
  function activeCardElement() {
    const active = document.activeElement;

    if (!(active instanceof Element) || !sectionRef.current?.contains(active)) {
      return null;
    }

    return active.closest(".showcase-card");
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
        const card = activeCardElement();
        const nodeId =
          card?.dataset?.showcaseNodeId != null
            ? Number(card.dataset.showcaseNodeId)
            : null;
        const node = Number.isInteger(nodeId)
          ? findNodeById(nodes, nodeId)
          : null;

        // A native button opens on Enter/Space in every mode but the edit-mode
        // grouping, which owns only a double-click handler. Handle just that
        // case so a view-mode note card toggles exactly once.
        if (editMode && node?.node_type === "grouping") {
          event.preventDefault();
          openNode(node);
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
            ?.querySelector('[aria-label="Create a grouping"]')
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

  // After a drill or an Up, bring focus back to the card for the node we left
  // when it is on the new level. A card that is no longer rendered is skipped,
  // so a drill into a node simply leaves focus unfocused.
  const drillKey = effectiveDrillIds.join("/");

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
  // A resolvable node with nothing under it is not the same as an empty
  // showcase: a Grouping holding only sub-Groupings is not empty.
  const showEmptyNode =
    !loading &&
    !loadError &&
    currentNode != null &&
    currentChildren.length === 0;
  const showViewEmptyNode = showEmptyNode && !editMode;
  const showEditEmptyNode = showEmptyNode && editMode;
  // A label can be placed at most once per Showcase, so do not suggest the ones
  // already on the canvas.
  const placedCategoryIds = new Set(
    nodes
      .map((node) => node.category_id)
      .filter((categoryId) => categoryId != null),
  );
  const availableCategories = categories.filter(
    (category) => !placedCategoryIds.has(category.id),
  );
  // The header's muted total (presentation spec §1): the loaded tree's note
  // count, or the showcase row's count until the tree arrives.
  const noteCount = loading
    ? (showcase?.note_count ?? 0)
    : countNoteNodes(nodes);

  return (
    <section className="screen-stack showcase-screen" ref={sectionRef}>
      <div className="panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            {editMode ? (
              <input
                aria-label="Showcase name"
                className="showcase-name-field"
                onBlur={commitName}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={handleNameKeyDown}
                ref={nameFieldRef}
                value={nameDraft}
              />
            ) : (
              <h1>{showcaseName}</h1>
            )}
            <p className="muted showcase-note-count">{`${noteCount} notes`}</p>
          </div>
          <div className="showcase-header-controls">
            <div className="showcase-photo-size">
              <ShowcasePhotoSizeControl
                onChange={setPhotoSize}
                value={photoSize}
              />
            </div>
            <div className="panel-heading-actions">
              {editMode ? (
                <Link
                  className="button"
                  to={SHOWCASE_ROUTES.showcase(showcaseId)}
                >
                  View
                </Link>
              ) : (
                <Link
                  className="button"
                  to={SHOWCASE_ROUTES.showcaseEdit(showcaseId)}
                >
                  Edit
                </Link>
              )}
              {editMode && showcase ? (
                <button
                  className="button button-danger"
                  disabled={deleting}
                  onClick={handleDelete}
                  type="button"
                >
                  Delete showcase
                </button>
              ) : null}
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

        {showEditEmptyNode ? (
          <div className="showcase-empty-box">
            <p className="showcase-empty-text">No notes here yet.</p>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <>
            {currentNode ? (
              <ShowcaseBreadcrumb
                showcaseName={showcaseName}
                onNavigate={navigateTo}
                path={currentPath}
              />
            ) : null}

            {editMode && currentNode?.node_type === "grouping" ? (
              <div className="showcase-node-cover">
                <span className="muted">
                  {currentNode.cover_note_id != null
                    ? "Cover set by hand."
                    : "Cover derives from the first note."}
                </span>
                {currentNode.cover_note_id != null ? (
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

            <ShowcaseGrid size={photoSize}>
              {currentChildren.map((node) => {
                if (node.node_type === "category") {
                  return editMode ? (
                    <ShowcaseCategoryEditor
                      key={node.id}
                      node={node}
                      onOpen={() => openNode(node)}
                      onRemove={handleRemoveCategory}
                      onRename={handleRenameCategory}
                    />
                  ) : (
                    <ShowcaseCategoryCard
                      key={node.id}
                      name={node.name}
                      nodeId={node.id}
                      onOpen={() => openNode(node)}
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
                          currentNode?.node_type === "grouping"
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

              {editMode && !currentNode && !showEditEmpty ? (
                <ShowcaseCategoryTile
                  categories={availableCategories}
                  onAdd={handleAddCategory}
                />
              ) : null}

              {editMode && currentNode ? (
                <>
                  <ShowcaseNoteTile
                    onClick={() => handleOpenNotePicker(currentNode)}
                  />
                  <ShowcaseGroupingTile onAdd={handleAddGrouping} />
                </>
              ) : null}
            </ShowcaseGrid>
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
