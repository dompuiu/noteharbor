// The class every tag chip wears. The chip plan below measures text with a
// probe wearing it, so the component that renders chips and the plan that
// sizes them have to agree on it — it lives here, next to the measurement.
export const tableTagClass = "tag table-tag";
const tagChipHorizontalPadding = 16;
const tagMoreChipHorizontalPadding = 14;
const tagListGap = 5;
const tagChipMeasureSafetyMargin = 2;
const measurementCacheLimit = 500;

let tagTextMeasureContext = null;
const chipWidthCache = new Map();

function getTagTextMeasureContext() {
  if (tagTextMeasureContext || typeof document === "undefined") {
    return tagTextMeasureContext;
  }

  const probe = document.createElement("button");
  probe.className = tableTagClass;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.textContent = "x";
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
  document.body.removeChild(probe);

  tagTextMeasureContext = context;
  return tagTextMeasureContext;
}

// Text measurement is the expensive part of a chip plan, and the same tag
// names repeat across rows. Cache the widths in a bounded map so a screen of
// notes with many shared tags measures each name and padding pair once.
export function measureTagChipWidth(
  text,
  horizontalPadding = tagChipHorizontalPadding,
) {
  const cacheKey = `${horizontalPadding}:${text}`;
  const cached = chipWidthCache.get(cacheKey);

  if (cached != null) {
    return cached;
  }

  const context = getTagTextMeasureContext();
  const width = context
    ? Math.ceil(context.measureText(text).width) +
      horizontalPadding +
      tagChipMeasureSafetyMargin
    : text.length * 8 + horizontalPadding;

  if (chipWidthCache.size >= measurementCacheLimit) {
    chipWidthCache.clear();
  }

  chipWidthCache.set(cacheKey, width);
  return width;
}

export function computeVisibleTagPlan(tags, availableWidth) {
  if (!tags.length) {
    return { visibleTags: [], hiddenTags: [] };
  }

  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { visibleTags: tags, hiddenTags: [] };
  }

  const chipWidths = tags.map((tag) => measureTagChipWidth(tag.name));
  const fullWidth = chipWidths.reduce(
    (sum, width, index) => sum + width + (index > 0 ? tagListGap : 0),
    0,
  );

  if (fullWidth <= availableWidth) {
    return { visibleTags: tags, hiddenTags: [] };
  }

  for (
    let visibleCount = tags.length - 1;
    visibleCount >= 0;
    visibleCount -= 1
  ) {
    const hiddenCount = tags.length - visibleCount;
    let width = measureTagChipWidth(
      `+${hiddenCount}`,
      tagMoreChipHorizontalPadding,
    );

    for (let i = 0; i < visibleCount; i += 1) {
      width += chipWidths[i] + tagListGap;
    }

    // At visibleCount 0 we always accept, so the "+N" counter is never
    // itself pushed out of view with no indicator left behind.
    if (width <= availableWidth || visibleCount === 0) {
      return {
        visibleTags: tags.slice(0, visibleCount),
        hiddenTags: tags.slice(visibleCount),
      };
    }
  }
}

export { tagListGap };
