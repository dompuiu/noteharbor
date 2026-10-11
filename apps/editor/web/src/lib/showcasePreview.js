// Showcase-wide image preview helpers (view mode only). The preview is a
// flattened slideshow over every visible note in the showcase, in the order
// the notes appear: top-level categories in position order, then each level's
// children recursively. Empty groupings/categories (no notes beneath them)
// are skipped, matching `visibleChildNodes` view semantics. Notes without
// any image produce no items and are excluded entirely.
import { countNoteNodes, findNodeById, findNodeIdPath } from "./showcaseTree.js";
import { pickNoteImage } from "./showcaseImages.js";
import { showcaseNoteDisplayParts } from "./showcaseNoteLabels.js";

// Depth-first visible notes. Returns [{ nodeId, note }] in display order.
function collectShowcasePreviewNotes(nodes) {
  const out = [];

  function walk(list) {
    for (const node of list ?? []) {
      if (node.node_type === "note") {
        if (node.note) {
          out.push({ nodeId: node.id, note: node.note });
        }
        continue;
      }

      if (node.node_type === "grouping" || node.node_type === "category") {
        if (countNoteNodes([node]) === 0) {
          continue;
        }
        walk(node.children ?? []);
        continue;
      }
    }
  }

  walk(nodes);
  return out;
}

function fullSrc(note, type) {
  return (
    pickNoteImage(note, type, "full") || pickNoteImage(note, type, "thumbnail")
  );
}

// Flattened front/back items over the whole showcase. Missing sides are
// skipped (no `includeMissingSides`): imageless notes yield zero items.
function getShowcasePreviewItems(nodes) {
  const items = [];

  for (const { nodeId, note } of collectShowcasePreviewNotes(nodes)) {
    const frontSrc = fullSrc(note, "front");
    const backSrc = fullSrc(note, "back");
    const denomination = String(note?.denomination ?? "").trim() || "note";

    if (frontSrc) {
      items.push({
        alt: `${denomination} front`,
        kind: "front",
        label: "Front",
        nodeId,
        note,
        noteId: note.id,
        src: frontSrc,
      });
    }

    if (backSrc) {
      items.push({
        alt: `${denomination} back`,
        kind: "back",
        label: "Back",
        nodeId,
        note,
        noteId: note.id,
        src: backSrc,
      });
    }
  }

  return items;
}

// Index of the requested card face. Falls back to the node's first item when
// the kind is missing (e.g. front requested on a back-only note); -1 when the
// node has no items at all.
function findShowcasePreviewIndex(items, nodeId, kind) {
  const exact = items.findIndex(
    (item) => item.nodeId === nodeId && item.kind === kind,
  );

  if (exact >= 0) {
    return exact;
  }

  return items.findIndex((item) => item.nodeId === nodeId);
}

function parseShowcasePreviewParam(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const [rawId, rawKind] = value.split(":");

  if (rawKind !== "front" && rawKind !== "back") {
    return null;
  }

  const nodeId = Number(rawId);

  if (!Number.isInteger(nodeId)) {
    return null;
  }

  return { kind: rawKind, nodeId };
}

function formatShowcasePreviewParam(nodeId, kind) {
  return `${nodeId}:${kind}`;
}

// Search string preserving the drill `node` alongside `preview`. `node` is
// the raw string from the URL (kept verbatim so category deep links survive);
// null clears that parameter.
function buildShowcasePreviewSearch({ node, previewNodeId, previewKind }) {
  const params = new URLSearchParams();

  if (node != null && String(node).trim() !== "") {
    params.set("node", String(node).trim());
  }

  if (previewNodeId != null && previewKind != null) {
    params.set(
      "preview",
      formatShowcasePreviewParam(previewNodeId, previewKind),
    );
  }

  const text = params.toString();
  return text ? `?${text}` : "";
}

// The drilled level containing the preview node: the deepest grouping
// ancestor, or null for the expanded root (top-level notes and notes under a
// category). Categories never have their own level.
function getShowcasePreviewContainingLevelId(nodes, previewNodeId) {
  const path = findNodeIdPath(nodes, previewNodeId);

  if (!path.length) {
    return null;
  }

  const ancestors = path.slice(0, -1);

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = findNodeById(nodes, ancestors[index]);

    if (ancestor?.node_type === "grouping") {
      return ancestor.id;
    }
  }

  return null;
}

function showcasePreviewLabel(note, kind) {
  const parts = showcaseNoteDisplayParts(note);
  const base = parts.length ? parts.join(", ") : "Untitled note";
  const face = kind === "back" ? "Back" : "Front";
  return `${base} - ${face}`;
}

export {
  buildShowcasePreviewSearch,
  collectShowcasePreviewNotes,
  findShowcasePreviewIndex,
  formatShowcasePreviewParam,
  getShowcasePreviewContainingLevelId,
  getShowcasePreviewItems,
  parseShowcasePreviewParam,
  showcasePreviewLabel,
};
