import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createCategory,
  createShowcaseNode,
  deleteNode,
  getCategories,
  getShowcaseTree,
  reorderNodes,
  updateNode,
} from "../lib/api.js";
import { usePhotoSize } from "../lib/photoSize.js";
import {
  DEFAULT_DESTINATION,
  PORTFOLIO_ROUTES,
  showcaseNodeSearch,
} from "../lib/routes.js";
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
import { ShowcaseNodeItems } from "./ShowcaseNodeItems.jsx";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";
import { ShowcaseNoteEditor } from "./ShowcaseNoteEditor.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { ShowcasePhotoSizeControl } from "./ShowcasePhotoSizeControl.jsx";
import { ShowcaseReorderableCell } from "./ShowcaseReorderableCell.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell, grid, and cards so the two never drift. Categories sit at the top
// level; a Category or Grouping opens into its own level (nothing expands
// inline), and each node also carries its notes and the note picker.
function upsertCategory(categories, category) {
  const others = categories.filter((entry) => entry.id !== category.id);
  return [...others, category].sort((a, b) => a.name.localeCompare(b.name));
}

// Walk the tree by the drilled node ids. A stale id (e.g. a node removed in
// another tab) stops the walk at the last resolvable level.
function findNodePath(nodes, ids) {
  const path = [];
  let level = nodes;

  for (const id of ids) {
    const node = level.find((entry) => entry.id === id);

    if (!node) {
      break;
    }

    path.push(node);
    level = node.children ?? [];
  }

  return path;
}

// The id chain from the root to `targetId`, or [] when it is not in this tree.
// View mode derives its drill state from the `?node=` parameter through this.
function findNodeIdPath(nodes, targetId) {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node.id];
    }

    const nested = findNodeIdPath(node.children ?? [], targetId);

    if (nested.length) {
      return [node.id, ...nested];
    }
  }

  return [];
}

// Replace one node anywhere in the tree, keeping the same references when the
// id is not present so React does not re-render untouched branches.
function updateNodeTree(nodes, nodeId, update) {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === nodeId) {
      changed = true;
      return update(node);
    }

    if (node.children?.length) {
      const children = updateNodeTree(node.children, nodeId, update);

      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
    }

    return node;
  });

  return changed ? next : nodes;
}

function removeNodeTree(nodes, nodeId) {
  let changed = false;
  const next = [];

  for (const node of nodes) {
    if (node.id === nodeId) {
      changed = true;
      continue;
    }

    if (node.children?.length) {
      const children = removeNodeTree(node.children, nodeId);

      if (children !== node.children) {
        changed = true;
        next.push({ ...node, children });
        continue;
      }
    }

    next.push(node);
  }

  return changed ? next : nodes;
}

function findNodeById(nodes, nodeId) {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    const found = findNodeById(node.children ?? [], nodeId);

    if (found) {
      return found;
    }
  }

  return null;
}

// Apply a batch of just-added children under their parent, anywhere in the tree,
// from the server's rows — no full refetch.
function appendChildren(nodes, parentId, added) {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: [...(node.children ?? []), ...added] };
    }

    if (node.children?.length) {
      return { ...node, children: appendChildren(node.children, parentId, added) };
    }

    return node;
  });
}

// Put a parent's children into the given id order, keeping any node the caller
// omitted at the end (defensive: the server rejects a partial list anyway).
function applyChildOrder(children, orderedIds) {
  const byId = new Map(children.map((node) => [node.id, node]));

  for (const nodeId of orderedIds) {
    byId.delete(nodeId);
  }

  const ordered = orderedIds
    .map((nodeId) => children.find((node) => node.id === nodeId))
    .filter(Boolean);

  return [...ordered, ...byId.values()];
}

// Apply a reorder to the local tree without refetching: the top level when the
// parent is null, otherwise the matching parent's children.
function reorderNodeTree(nodes, parentId, orderedIds) {
  if (parentId == null) {
    return applyChildOrder(nodes, orderedIds);
  }

  return updateNodeTree(nodes, parentId, (parent) => ({
    ...parent,
    children: applyChildOrder(parent.children ?? [], orderedIds),
  }));
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
  const { confirm, dialog } = useConfirmation();
  const { collections } = useCollections();
  // The picker's target node id (not the node object) so the open popup reads
  // the node's current children after an add updates the tree.
  const [pickerNodeId, setPickerNodeId] = useState(null);
  // The photo size is a per-browser preference shared by view and edit mode.
  const [photoSize, setPhotoSize] = usePhotoSize();

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
        navigate(PORTFOLIO_ROUTES.showcaseEdit(nextShowcaseId));
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
  const currentChildren = currentNode ? currentNode.children ?? [] : nodes;

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
    if (editMode) {
      setDrillIds((current) => [...current, node.id]);
      return;
    }

    navigate({ search: showcaseNodeSearch(node.id) });
  }

  // `-1` is the Showcase root; any other index opens that breadcrumb level.
  function navigateTo(targetIndex) {
    if (editMode) {
      setDrillIds((current) =>
        targetIndex < 0 ? [] : current.slice(0, targetIndex + 1),
      );
      return;
    }

    const targetId =
      targetIndex < 0 ? null : effectiveDrillIds[targetIndex] ?? null;
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

  const pickerNode =
    pickerNodeId == null ? null : findNodeById(nodes, pickerNodeId);

  const showEmpty = !loading && !loadError && nodes.length === 0;
  // A resolvable node with nothing under it is not the same as an empty
  // showcase: a Grouping holding only sub-Groupings is not empty.
  const showEmptyNode =
    !loading && !loadError && currentNode != null && currentChildren.length === 0;
  // A label can be placed at most once per Showcase, so do not suggest the ones
  // already on the canvas.
  const placedCategoryIds = new Set(
    nodes.map((node) => node.category_id).filter((categoryId) => categoryId != null),
  );
  const availableCategories = categories.filter(
    (category) => !placedCategoryIds.has(category.id),
  );

  return (
    <section className="screen-stack showcase-screen">
      <div className="panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            <p className="eyebrow">Showcases</p>
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
          </div>
          <div className="showcase-photo-size">
            <ShowcasePhotoSizeControl
              onChange={setPhotoSize}
              value={photoSize}
            />
          </div>
          {editMode && showcase ? (
            <div className="panel-heading-actions">
              <button
                className="button button-danger"
                disabled={deleting}
                onClick={handleDelete}
                type="button"
              >
                Delete showcase
              </button>
            </div>
          ) : null}
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

        {loading ? <p className="muted showcase-empty">Loading showcase…</p> : null}

        {!loading && loadError ? (
          <p className="showcase-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {showEmpty ? (
          <p className="muted showcase-empty">This showcase is empty.</p>
        ) : null}

        {showEmptyNode ? (
          <p className="muted showcase-empty">No notes here yet.</p>
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
                    >
                      <ShowcaseNodeItems
                        node={node}
                        onAddNotes={handleOpenNotePicker}
                        onRemoveNote={handleRemoveNote}
                      />
                    </ShowcaseCategoryEditor>
                  ) : (
                    <ShowcaseCategoryCard
                      key={node.id}
                      name={node.name}
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
                      >
                        <ShowcaseNodeItems
                          node={node}
                          onAddNotes={handleOpenNotePicker}
                          onRemoveNote={handleRemoveNote}
                        />
                      </ShowcaseGroupingEditor>
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
                      />
                    </ShowcaseReorderableCell>
                  ) : (
                    <ShowcaseNoteCard
                      key={node.id}
                      mode="view"
                      note={node.note}
                    />
                  );
                }

                return null;
              })}

              {editMode && !currentNode ? (
                <ShowcaseCategoryTile
                  categories={availableCategories}
                  onAdd={handleAddCategory}
                />
              ) : null}

              {editMode && currentNode ? (
                <ShowcaseGroupingTile onAdd={handleAddGrouping} />
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

      {dialog}
    </section>
  );
}

export { ShowcaseScreen };
