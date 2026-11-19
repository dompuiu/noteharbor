// The rail's filter chips take one line. They can number a dozen after a few
// commits, so the rail plans how many whole units (connector + value chip) fit
// against the measured width and gives the rest to a `+N` chip that opens the
// full list. The plan measures text the same way the tag chip plan does: a
// hidden probe in the built app, a fixed fallback where canvas is absent
// (jsdom), so the tests and the browser agree on the shape.
import { filterFieldLabel, groupConditions } from "./tableFilters.js";

const chipTextMeasureContexts = new Map();
const chipWidthCache = new Map();
const measurementCacheLimit = 500;

const valueProbeClass = "table-filter-chip-value";
const labelProbeClass = "table-filter-facet-label";
const moreProbeClass = "table-filter-more";

// Horizontal cost beyond the text itself: the chip's 2px border, its 1px
// right padding, the 1px gap before the cross, the value button's 9px of
// padding and the 17px cross. The connectors' costs are their own paddings
// plus the unit's 5px gap; a label keeps its 1px margin too.
const chipChromeWidth = 30;
const labelGap = 6;
const orGap = 11;
const andGap = 21;
const unitGap = 4;
// Clear all is a fixed word at the line's end; reserving it keeps the plan
// from letting the last chip sit under the control.
const clearAllReserve = 70;
// Text is measured on a canvas, so the line it is planned into has to be a
// few pixels generously wrong before it is exactly wrong.
const lineSafety = 6;

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
  // The count badge's own 6px paddings and 2px border on each side.
  return measureWithProbe(moreProbeClass, text, 7) + 14;
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

// The chips share the filter field's line only while every condition fits
// beside it. As soon as the plan would need a `+N` count there, the chips take
// a row of their own, where the count is only used if even the full row cannot
// hold them. A lone condition never needs a count, so it stays on the line and
// truncates. These are the rail's fixed costs: its 10px paddings, the 12px gap
// between the field, the chips and the trailing controls, and the field's
// width. The rail's grid gives the field its full 400px whenever the line has
// that much, whatever the chips would like, so reserving the basis is exact
// rather than cautious.
const railChipPadding = 20;
const railChipGap = 12;
const filterFieldWidth = 400;

// The conditions as the chip line reads them: one unit per chip, in table
// order, carrying the connector it follows ("and" for a new field, "or" for
// the next value of the same one). The rail and the budget plan the same list,
// so the count a `+N` promises can never drift from the chips on the line.
export function filterChipUnits(conditions) {
  return groupConditions(conditions).flatMap(({ field, items }, groupIndex) =>
    items.map((condition, index) => ({
      condition,
      field,
      groupIndex,
      index,
      label: filterFieldLabel(field),
    })),
  );
}

// Decides how much width the chips may use and whether they can stay beside
// the field at all. They leave the field's line the moment the inline plan
// would hide a condition behind `+N`, even when a truncated chip would fit:
// the count belongs to a row with room to name what it hides. A lone condition
// never needs the count, so it stays inline and truncates. The own-line case
// reports the rail's whole content box, because that is the row it gets. Until
// the trailing cluster is measured the answer is "unknown", which the plan
// reads as "show everything" and the stylesheet as "wrap if you must".
export function computeFilterChipBudget({
  actionsWidth = null,
  railWidth = null,
  units,
}) {
  if (!Number.isFinite(railWidth) || railWidth <= 0) {
    return { availableWidth: null, ownLine: false };
  }

  const innerWidth = railWidth - railChipPadding;

  if (!Number.isFinite(actionsWidth) || actionsWidth <= 0) {
    return { availableWidth: null, ownLine: false };
  }

  const inlineWidth =
    innerWidth - filterFieldWidth - actionsWidth - railChipGap * 2;

  if (inlineWidth <= 0) {
    return { availableWidth: innerWidth, ownLine: true };
  }

  if (computeFilterChipPlan(units, inlineWidth).hiddenCount > 0) {
    return { availableWidth: innerWidth, ownLine: true };
  }

  return { availableWidth: inlineWidth, ownLine: false };
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
  const budget = availableWidth - clearAllReserve - lineSafety;
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
