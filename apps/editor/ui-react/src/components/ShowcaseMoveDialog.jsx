import { useState } from "react";
import {
  findNodeById,
  findNodeIdPath,
  findParentId,
  showcaseNodeLabel,
} from "../lib/showcaseTree.js";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";

function destinationRows(nodes, source) {
  const rows = [
    { id: null, name: "Showcase (top level)", depth: 0, kind: "Level" },
  ];

  const walk = (level, depth) => {
    for (const node of level ?? []) {
      if (node.node_type !== "category" && node.node_type !== "grouping") {
        continue;
      }

      const isSelf = node.id === source.id;
      const nodePath = findNodeIdPath(nodes, node.id);
      const isInside =
        nodePath.includes(source.id) && node.id !== source.id;
      const wrongLevel =
        source.node_type === "category";
      const disabled = isSelf || isInside || wrongLevel;

      rows.push({
        id: node.id,
        name: node.name,
        depth,
        kind: node.node_type === "category" ? "Category" : "Grouping",
        disabled,
        why: isSelf
          ? "cannot move into itself"
          : isInside
            ? "inside this item"
            : "",
      });
      walk(node.children, depth + 1);
    }
  };

  walk(nodes, 0);

  return rows.map((row) =>
    row.id == null
      ? {
          ...row,
          disabled: source.node_type === "category" ? false : true,
          why: source.node_type === "category" ? "" : "needs a category or grouping",
        }
      : row,
  );
}

// The keyboard and single-pointer path for nesting. It lists every container
// in the tree, disables the destinations the server would refuse, and appends
// to the chosen level. Dragging can only reach the cards on screen; this dialog
// reaches the rest.
function ShowcaseMoveDialog({ nodes, onClose, onMove, source }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rows = destinationRows(nodes, source);
  const currentParent = findParentId(nodes, source.id);
  const selected =
    rows.find((row) => row.id === currentParent && !row.disabled) ??
    rows.find((row) => !row.disabled);
  const note =
    source.node_type === "category"
      ? "A category placement stays at the top level."
      : "The card appends to the end of the chosen level.";

  async function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const raw = data.get("showcase-move-destination");
    const parentId = raw === "" || raw == null ? null : Number(raw);
    const parent = parentId == null ? null : findNodeById(nodes, parentId);
    const position = (parent?.children ?? []).filter(
      (child) => child.id !== source.id,
    ).length;

    setSaving(true);
    setError("");

    const moved = await onMove(source.id, parentId, position);

    if (moved) {
      onClose();
      return;
    }

    setSaving(false);
    setError("Could not move the item. The card stayed where it was.");
  }

  return (
    <ShowcaseDialog
      onClose={saving ? () => {} : onClose}
      subtitle={note}
      title={`Move “${showcaseNodeLabel(source)}” into…`}
    >
      <form className="showcase-move-form" onSubmit={handleSubmit}>
        <div
          aria-label="Destination"
          className="showcase-move-list"
          role="radiogroup"
        >
          {rows.map((row) => (
            <label
              className={`showcase-move-option${row.disabled ? " showcase-move-option--disabled" : ""}`}
              key={row.id ?? "root"}
              style={{ "--showcase-move-depth": row.depth }}
            >
              <input
                autoFocus={row.id === selected?.id}
                defaultChecked={row.id === selected?.id}
                disabled={row.disabled}
                name="showcase-move-destination"
                type="radio"
                value={row.id ?? ""}
              />
              <span className="showcase-move-name">{row.name}</span>
              {row.why ? (
                <span className="showcase-move-why">{row.why}</span>
              ) : null}
              <span className="showcase-move-kind">{row.kind}</span>
            </label>
          ))}
        </div>

        {error ? (
          <p className="showcase-move-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="showcase-move-actions">
          <button
            className="button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={saving || !selected}
            type="submit"
          >
            {saving ? "Moving…" : "Move"}
          </button>
        </div>
      </form>
    </ShowcaseDialog>
  );
}

export { ShowcaseMoveDialog };
