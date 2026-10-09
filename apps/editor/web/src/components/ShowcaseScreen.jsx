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
import { usePhotoSize } from "../lib/photoSize.js";
import { DEFAULT_DESTINATION, PORTFOLIO_ROUTES } from "../lib/routes.js";
import { useShowcases } from "../lib/showcases.jsx";
import { useCollections } from "../lib/collections.jsx";
import { ShowcaseCategoryCard } from "./ShowcaseCategoryCard.jsx";
import { ShowcaseCategoryEditor } from "./ShowcaseCategoryEditor.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";
import { ShowcaseNodeItems } from "./ShowcaseNodeItems.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";
import { ShowcasePhotoSizeControl } from "./ShowcasePhotoSizeControl.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell, grid, and cards so the two never drift. Ticket 08 places
// Categories at the top level; ticket 10 adds each node's notes and the picker.
function upsertCategory(categories, category) {
  const others = categories.filter((entry) => entry.id !== category.id);
  return [...others, category].sort((a, b) => a.name.localeCompare(b.name));
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

function removeNodeById(nodes, nodeId) {
  return nodes
    .filter((node) => node.id !== nodeId)
    .map((node) =>
      node.children?.length
        ? { ...node, children: removeNodeById(node.children, nodeId) }
        : node,
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
    setNodes((current) => removeNodeById(current, noteNode.id));
  }

  const pickerNode =
    pickerNodeId == null ? null : findNodeById(nodes, pickerNodeId);

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
          <ShowcaseGrid size={photoSize}>
            {nodes.map((node) =>
              editMode ? (
                <ShowcaseCategoryEditor
                  key={node.id}
                  node={node}
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
                <ShowcaseCategoryCard key={node.id} name={node.name} />
              ),
            )}

            {editMode ? (
              <ShowcaseCategoryTile
                categories={availableCategories}
                onAdd={handleAddCategory}
              />
            ) : null}
          </ShowcaseGrid>
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
