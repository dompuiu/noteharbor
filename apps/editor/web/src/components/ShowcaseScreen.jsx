import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  createCategory,
  createShowcaseNode,
  deleteNode,
  getCategories,
  getShowcaseTree,
  updateNode,
} from "../lib/api.js";
import { useShowcases } from "../lib/showcases.jsx";
import { ShowcaseCategoryCard } from "./ShowcaseCategoryCard.jsx";
import { ShowcaseCategoryEditor } from "./ShowcaseCategoryEditor.jsx";
import { ShowcaseCategoryTile } from "./ShowcaseCategoryTile.jsx";
import { ShowcaseGrid } from "./ShowcaseGrid.jsx";

// One showcase, rendered in one of two near-identical modes. View mode is the
// read-only presentation; edit mode adds the authoring controls. Both share the
// same shell, grid, and cards so the two never drift. Ticket 08 places
// Categories at the top level; group, note, and order controls follow.
function upsertCategory(categories, category) {
  const others = categories.filter((entry) => entry.id !== category.id);
  return [...others, category].sort((a, b) => a.name.localeCompare(b.name));
}

function ShowcaseScreen({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const { showcases } = useShowcases();
  const showcaseId = Number(id);
  const showcase = showcases.find((entry) => entry.id === showcaseId) ?? null;
  const showcaseName = showcase?.name ?? "Showcase";
  const editMode = mode === "edit";
  // Arriving from `+ New showcase` opens the name field focused (and selected)
  // so the user can name the showcase immediately.
  const justCreated = editMode && Boolean(location.state?.justCreated);
  const nameFieldRef = useRef(null);

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
                defaultValue={showcaseName}
                key={showcaseName}
                ref={nameFieldRef}
              />
            ) : (
              <h1>{showcaseName}</h1>
            )}
          </div>
        </div>

        {loading ? <p className="muted showcase-empty">Loading showcase…</p> : null}

        {!loading && loadError ? (
          <p className="showcase-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {showEmpty ? (
          <p className="muted showcase-empty">
            This showcase is empty.
          </p>
        ) : null}

        {!loading && !loadError ? (
          <ShowcaseGrid>
            {nodes.map((node) =>
              editMode ? (
                <ShowcaseCategoryEditor
                  key={node.id}
                  node={node}
                  onRemove={handleRemoveCategory}
                  onRename={handleRenameCategory}
                />
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
    </section>
  );
}

export { ShowcaseScreen };
