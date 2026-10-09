import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createCategory,
  createShowcaseNode,
  deleteNode,
  getCategories,
  getShowcaseTree,
  updateNode,
} from "../lib/api.js";
import { DEFAULT_DESTINATION, PORTFOLIO_ROUTES } from "../lib/routes.js";
import { useShowcases } from "../lib/showcases.jsx";
import { ShowcaseCategoryCard } from "./ShowcaseCategoryCard.jsx";
import { ShowcaseCategoryEditor } from "./ShowcaseCategoryEditor.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseBreadcrumb } from "./ShowcaseBreadcrumb.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";
import { ShowcaseGroupingEditor } from "./ShowcaseGroupingEditor.jsx";
import { ShowcaseGroupingTile } from "./ShowcaseGroupingTile.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell, grid, and cards so the two never drift. Categories sit at the top
// level; a Category or Grouping opens into its own level (nothing expands
// inline). Notes render in ticket 10.
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

  const [nodes, setNodes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // The drilled node ids, root first. Edit mode keeps this in memory (the URL
  // does not change during edits); view-mode URL sync is ticket 12.
  const [drillIds, setDrillIds] = useState([]);

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

  // The current drill level. `currentParentId` is the node a new Grouping is
  // created under (null at the top level, where only Categories live).
  const currentPath = findNodePath(nodes, drillIds);
  const currentNode = currentPath.length
    ? currentPath[currentPath.length - 1]
    : null;
  const currentParentId = currentNode ? currentNode.id : null;
  const currentChildren = currentNode ? currentNode.children ?? [] : nodes;

  function openNode(node) {
    setDrillIds((current) => [...current, node.id]);
  }

  // `-1` is the Showcase root; any other index opens that breadcrumb level.
  function navigateTo(targetIndex) {
    setDrillIds((current) =>
      targetIndex < 0 ? [] : current.slice(0, targetIndex + 1),
    );
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

  const showEmpty = !loading && !loadError && nodes.length === 0;
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

        {!loading && !loadError ? (
          <>
            {currentNode ? (
              <ShowcaseBreadcrumb
                showcaseName={showcaseName}
                onNavigate={navigateTo}
                path={currentPath}
              />
            ) : null}

            <ShowcaseGrid>
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
                      onOpen={() => openNode(node)}
                    />
                  );
                }

                if (node.node_type === "grouping") {
                  return editMode ? (
                    <ShowcaseGroupingEditor
                      key={node.id}
                      node={node}
                      onOpen={() => openNode(node)}
                      onRemove={handleRemoveGrouping}
                      onRename={handleRenameGrouping}
                    />
                  ) : (
                    <ShowcaseGroupingCard
                      key={node.id}
                      node={node}
                      onOpen={() => openNode(node)}
                    />
                  );
                }

                // Note cards arrive in ticket 10.
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

      {dialog}
    </section>
  );
}

export { ShowcaseScreen };
