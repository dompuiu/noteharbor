import { useId } from "react";
import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { resolveGroupingCover } from "../lib/showcaseCovers.js";
import { isCatalogEntry } from "../lib/showcaseTree.js";

// The spring's progress bar is drawn inside the photo well, not on the cell:
// the hold fills under the picture, the same place the prototype puts it.
function SpringMeter() {
  return <span aria-hidden="true" className="showcase-spring-meter" />;
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countContents(children) {
  return {
    notes: children.filter((node) => node.node_type === "note").length,
    entries: children.filter(isCatalogEntry).length,
    groupings: children.filter((node) => node.node_type === "grouping")
      .length,
  };
}

// The footer states what sits directly inside the Grouping. Notes, catalog
// placeholders and nested Groupings each get their own count; an empty
// Grouping says so instead of printing three zeroes.
function groupingContents({ notes, entries, groupings }) {
  if (notes + entries + groupings === 0) {
    return "No items yet";
  }

  return [
    notes > 0 ? countLabel(notes, "note", "notes") : "",
    entries > 0
      ? countLabel(entries, "placeholder", "placeholders")
      : "",
    groupings > 0 ? countLabel(groupings, "grouping", "groupings") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function FolderIcon({ className }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path
        d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

// The Grouping card. The reveal chrome is folded into the card rather than
// sitting in a second bar above it: the grip lives in the header's left
// gutter, the actions menu in its right gutter, and both are siblings of the
// card button because the menu trigger is its own button.
//
// - `folio` (labels layout): one header, a hairline photo well, a contents row
//   and an action row. The four rows match a catalog card's header, photo,
//   metadata and ownership rows, so the cards line up in one grid row.
// - `rail` (Auction rail): the rail-label composition — photo left, the
//   identity rail right with the folder-led GROUPING kicker, name, contents and
//   the large count, and the same action row under both columns.
function ShowcaseGroupingCard({
  grip = null,
  layout = "labels",
  menu = null,
  node,
  onOpen,
  springing = false,
}) {
  const coverImage = firstAvailableNoteImage(resolveGroupingCover(node));
  const counts = countContents(node.children ?? []);
  const contents = groupingContents(counts);
  const total = counts.notes + counts.entries;
  const contentsId = useId();
  const rail = layout === "rail";
  const className = `showcase-grouping${rail ? " showcase-grouping--rail" : ""}${
    grip ? " showcase-grouping--grip" : ""
  }${menu ? " showcase-grouping--menu" : ""}`;
  const summary = (
    <span className="showcase-grouping-summary" id={contentsId}>
      {contents}
    </span>
  );
  const action = <span className="showcase-grouping-action">Open →</span>;

  const cover = coverImage ? (
    <img alt="" className="showcase-grouping-photo" src={coverImage.path} />
  ) : (
    <span aria-hidden="true" className="showcase-grouping-empty">
      <FolderIcon className="showcase-grouping-empty-icon" />
      <span>No cover</span>
    </span>
  );

  return (
    <div className={className}>
      <button
        aria-describedby={contentsId}
        aria-label={`Open grouping ${node.name}`}
        className={`showcase-card showcase-card--grouping${
          rail ? " showcase-card--grouping-rail" : ""
        }`}
        data-showcase-node-id={node.id}
        onClick={onOpen}
        type="button"
      >
        {rail ? (
          <>
            <span className="showcase-grouping-rail-main">
              <span className="showcase-grouping-well">
                {cover}
                {springing ? <SpringMeter /> : null}
              </span>
              <span className="showcase-grouping-rail-body">
                <span
                  aria-hidden="true"
                  className="showcase-grouping-rail-gutter"
                />
                <span className="showcase-grouping-kicker">
                  <FolderIcon className="showcase-grouping-kicker-icon" />
                  <span>Grouping</span>
                </span>
                <span className="showcase-grouping-name-text">
                  {node.name}
                </span>
                {summary}
                {total > 0 ? (
                  <span className="showcase-grouping-rail-stats">
                    <span className="showcase-grouping-rail-count">
                      {total}
                    </span>
                    <span className="showcase-grouping-rail-unit">
                      {total === 1 ? "item" : "items"}
                    </span>
                  </span>
                ) : null}
              </span>
            </span>
            {action}
          </>
        ) : (
          <>
            <span className="showcase-grouping-head">
              <FolderIcon className="showcase-grouping-head-icon" />
              <span className="showcase-grouping-name-text">{node.name}</span>
            </span>
            <span className="showcase-grouping-well">
              {cover}
              {springing ? <SpringMeter /> : null}
            </span>
            <span className="showcase-grouping-meta">{summary}</span>
            {action}
          </>
        )}
      </button>
      {grip}
      {menu}
    </div>
  );
}

export { ShowcaseGroupingCard };
