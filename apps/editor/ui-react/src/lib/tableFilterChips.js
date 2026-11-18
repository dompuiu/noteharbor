// The rail's filter chips take one line. They can number a dozen after a few
// commits, so the rail plans how many whole units (connector + value chip) fit
// against the measured width and gives the rest to a `+N` chip that opens the
// full list. The plan measures text the same way the tag chip plan does: a
// hidden probe in the built app, a fixed fallback where canvas is absent
// (jsdom), so the tests and the browser agree on the shape.
const chipTextMeasureContexts = new Map();
const chipWidthCache = new Map();
const measurementCacheLimit = 500;

const valueProbeClass = "table-filter-chip-value";
const labelProbeClass = "table-filter-facet-label";
const moreProbeClass = "table-filter-more";

// Horizontal cost beyond the text itself: the value button's 6px + 3px
// padding, the 17px remove cross, the chip's 2px border and the 1px gap
// between value and cross.
const chipChromeWidth = 29;
const labelGap = 5;
const orGap = 6;
const andGap = 16;
const unitGap = 4;
// Clear all is a fixed word at the line's end; reserving it keeps the plan
// from letting the last chip sit under the control.
const clearAllReserve = 70;

function measureWithProbe(className, text, fallbackCharWidth) {
  const cacheKey = `${className}:${text}`;
  const cached = chipWidthCache.get(cacheKey);

  if (cached != null) {
    return cached;
  }

  let context = chipTextMeasureContexts.get(className);

  if (context === undefined) {
    context = null;

    if (typeof document !== "undefined") {
      const probe = document.createElement("span");
      probe.className = className;
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.textContent = "x";
      document.body.appendChild(probe);
      const computed = window.getComputedStyle(probe);
      const canvas = document.createElement("canvas");
      const canvasContext = canvas.getContext("2d");

      if (canvasContext) {
        canvasContext.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        context = canvasContext;
      }

      document.body.removeChild(probe);
    }

    chipTextMeasureContexts.set(className, context);
  }

  const width = context
    ? Math.ceil(context.measureText(text).width)
    : Math.ceil(text.length * fallbackCharWidth);

  if (chipWidthCache.size >= measurementCacheLimit) {
    chipWidthCache.clear();
  }

  chipWidthCache.set(cacheKey, width);
  return width;
}

function measureValue(text) {
  return measureWithProbe(valueProbeClass, text, 6.8);
}

function measureLabel(text) {
  return measureWithProbe(labelProbeClass, text, 6.2);
}

function measureMore(text) {
  return measureWithProbe(moreProbeClass, text, 7) + 12;
}

function chipWidth(unit) {
  const value = `${unit.condition.negated ? "!" : ""}${unit.condition.value}`;

  return measureValue(value) + chipChromeWidth;
}

function unitWidth(unit) {
  if (unit.groupIndex > 0 && unit.index === 0) {
    return measureLabel(unit.label) + andGap + chipWidth(unit);
  }

  if (unit.index > 0) {
    return measureLabel("or") + orGap + chipWidth(unit);
  }

  return measureLabel(unit.label) + labelGap + chipWidth(unit);
}

// Returns how many units stay on the line. One unit is always visible, even
// when its chip is wider than the budget: the chip truncates, and a lone
// condition hidden behind `+1` would say less than the value it names.
export function computeFilterChipPlan(units, availableWidth) {
  if (!units.length) {
    return { hiddenCount: 0, visibleCount: 0 };
  }

  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { hiddenCount: 0, visibleCount: units.length };
  }

  const widths = units.map(unitWidth);
  const budget = availableWidth - clearAllReserve;
  const fullWidth = widths.reduce(
    (sum, width, index) => sum + width + (index > 0 ? unitGap : 0),
    0,
  );

  if (fullWidth <= budget) {
    return { hiddenCount: 0, visibleCount: units.length };
  }

  for (
    let visibleCount = units.length - 1;
    visibleCount >= 1;
    visibleCount -= 1
  ) {
    const hiddenCount = units.length - visibleCount;
    let width = measureMore(`+${hiddenCount}`) + unitGap;

    for (let index = 0; index < visibleCount; index += 1) {
      width += widths[index] + unitGap;
    }

    if (width <= budget) {
      return { hiddenCount, visibleCount };
    }
  }

  // One chip always stays on the line: the chip itself truncates, and a lone
  // condition hidden behind `+1` would say less than the value it names.
  return { hiddenCount: units.length - 1, visibleCount: 1 };
}
