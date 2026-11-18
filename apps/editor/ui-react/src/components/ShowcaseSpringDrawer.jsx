import {
  showcaseNodeLabel,
  showcaseNodeTypeLabel,
} from "../lib/showcaseTree.js";

// The spring-opened drawer under a container card. It is a drop surface, not a
// second card grid: each direct child is one row whose top and bottom halves
// are insertion targets, so a drop lands exactly where the collector points
// without reading a line between cards.
function ShowcaseSpringDrawer({
  drawerTarget,
  draggedId,
  items,
  label,
  onDragOverEmpty,
  onDragOverInto,
  onDragOverRow,
  onDropEmpty,
  onDropInto,
  onDropRow,
  parentId,
}) {
  const empty = items.length === 0;
  const emptyTarget =
    !empty || !drawerTarget
      ? false
      : drawerTarget.parentId === parentId && drawerTarget.placement === "into";

  return (
    <div
      className="showcase-spring-drawer"
      data-showcase-spring={parentId}
      onDragOver={empty ? onDragOverEmpty : (event) => event.stopPropagation()}
      onDrop={empty ? onDropEmpty : undefined}
    >
      <p className="showcase-spring-title">
        <span>Inside</span>
        <span className="showcase-spring-name">{label}</span>
      </p>
      {empty ? (
        <p
          className={`showcase-spring-empty${emptyTarget ? " showcase-spring-empty--target" : ""}`}
        >
          Empty — release to move the card inside
        </p>
      ) : (
        <ul className="showcase-spring-list">
          {items.map((node) => {
            const placement =
              drawerTarget?.childId === node.id &&
              drawerTarget?.parentId === parentId
                ? drawerTarget.placement
                : null;
            return (
              <li
                className={`showcase-spring-row${placement ? ` showcase-spring-row--drop-${placement}` : ""}${
                  node.id === draggedId ? " showcase-spring-row--source" : ""
                }`}
                key={node.id}
                onDragOver={(event) =>
                  onDragOverRow(event, node.id, { parentId, children: items })
                }
                onDrop={(event) =>
                  onDropRow(event, node.id, { parentId, children: items })
                }
              >
                <span className="showcase-spring-row-label">
                  {showcaseNodeLabel(node)}
                </span>
                {node.node_type === "grouping" ? (
                  <span
                    className={`showcase-spring-into${
                      drawerTarget?.parentId === node.id &&
                      drawerTarget?.placement === "into"
                        ? " showcase-spring-into--target"
                        : ""
                    }`}
                    onDragOver={(event) => onDragOverInto?.(event, node.id)}
                    onDrop={(event) => onDropInto?.(event, node.id)}
                  >
                    Into
                  </span>
                ) : null}
                <span className="showcase-spring-row-type">
                  {showcaseNodeTypeLabel(node)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { ShowcaseSpringDrawer };
