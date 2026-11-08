import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  copyTextToClipboard,
  formatNoteAsTsvRow,
} from "../lib/noteClipboard.js";
import { isEditableElement } from "../lib/editableElement.js";
import {
  neighbouringImageSources,
  preloadImage,
  useImagePreload,
} from "../lib/imagePreload.js";
import { gradeTier } from "../lib/tableColumns.js";
import { NoteCounter } from "./NoteCounter.jsx";

function formatScrapedLabel(label) {
  return String(label ?? "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function getScrapePanelTitle(note) {
  const company = String(note?.grading_company ?? "").trim();
  return company ? `${company} scrape` : "Scraped details";
}

function getNoteDisplayLabel(note) {
  const denomination = String(note?.denomination ?? "").trim();
  const catalogNumber = String(note?.catalog_number ?? "").trim();

  if (denomination && catalogNumber) {
    return `${denomination} - ${catalogNumber}`;
  }

  return denomination || catalogNumber || "Untitled note";
}

function getNoteTitle(note) {
  return String(note?.denomination ?? "").trim() || "Untitled note";
}

// The scraped labels that are worth a place on the slide itself. Each group
// lists the spellings the three graders use so one value is shown once, never
// repeated under two labels.
const scrapedDetailCuration = [
  { label: "Country", keys: ["country", "region"] },
  {
    label: "Catalog",
    keys: ["catalog", "catalog_number", "catalog_no", "world_pick"],
  },
  {
    label: "Date",
    keys: ["date", "issue_date", "currency_date", "year", "years"],
  },
  { label: "Grade", keys: ["grade", "display_grade", "grade_desc"] },
  {
    label: "Comment",
    keys: ["comment", "comments", "page_comments", "banknote_details"],
  },
];

function getScrapedDetailSections(entries) {
  const values = new Map(entries);
  const curated = [];
  const consumed = new Set();

  scrapedDetailCuration.forEach(({ label, keys }) => {
    const key = keys.find((candidate) => values.has(candidate));

    if (!key) {
      return;
    }

    const value = values.get(key);
    curated.push([label, value]);

    // Hide the spellings that repeat the chosen value, but keep a synonym
    // that carries something different for the disclosure.
    keys.forEach((candidate) => {
      if (
        values.has(candidate) &&
        String(values.get(candidate)) === String(value)
      ) {
        consumed.add(candidate);
      }
    });
  });

  return {
    curated,
    more: entries.filter(([key]) => !consumed.has(key)),
  };
}

function getSourceHost(value) {
  try {
    return new URL(String(value)).host || "View source page";
  } catch {
    return "View source page";
  }
}

function getScrapedDetailEntries(note) {
  const scrapedData = note.scraped_data;
  const details =
    scrapedData && typeof scrapedData === "object"
      ? scrapedData.details && typeof scrapedData.details === "object"
        ? scrapedData.details
        : scrapedData
      : null;

  if (!details || typeof details !== "object") {
    return [];
  }

  return Object.entries(details).filter(([key, value]) => {
    if (key === "images" || key === "details") {
      return false;
    }

    if (value === null || value === undefined) {
      return false;
    }

    return String(value).trim() !== "";
  });
}

function versionedImagePath(path, version) {
  if (!path) {
    return null;
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

function hasModifierPressed(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

// The controls that already activate on Enter/Space must receive those
// presses instead of the room's global shortcuts.
const NATIVE_CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, summary, [role='button']";

function isNativeControl(target) {
  return (
    target instanceof Element &&
    target.closest(NATIVE_CONTROL_SELECTOR) !== null
  );
}

// The elements the browser's own Tab walk would visit, in document order.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(container) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.closest("[hidden], [aria-hidden='true'], [inert]") === null,
  );
}

// Keep Tab inside an open dialog. A control elsewhere on the page (a sibling
// dialog, for instance) keeps its own Tab walk; the app behind the room is
// inert, so focus only needs pulling back when it fell to <body> or when the
// walk reached the room's own first/last control.
function trapTabKey(event, container) {
  if (event.key !== "Tab") {
    return false;
  }

  const focusable = focusableWithin(container);

  if (!focusable.length) {
    event.preventDefault();
    container?.focus({ preventScroll: true });
    return true;
  }

  const active = document.activeElement;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const atRoom = active === container;
  const inside =
    atRoom || (active instanceof Node && container?.contains(active));

  if (!inside && active !== document.body) {
    return false;
  }

  const wrapBackward = event.shiftKey && (atRoom || !inside || active === first);
  const wrapForward = !event.shiftKey && (atRoom || !inside || active === last);

  if (!wrapBackward && !wrapForward) {
    return false;
  }

  event.preventDefault();
  (wrapBackward ? last : first).focus({ preventScroll: true });
  return true;
}

// The arrow keys with h/j/k/l aliased onto them. A held Shift (or Caps Lock)
// spells the letters uppercase ("H", "L", …), so callers resolve the key
// through directionOf, which lowercases a single-character key before the
// lookup.
const arrowDirections = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  h: "left",
  j: "down",
  k: "up",
  l: "right",
};

function directionOf(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return arrowDirections[key];
}

function pickImage(note, type, variant = "full") {
  const imagePath =
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(imagePath, note.updated_at);
}

function getPreviewItems(note, { includeMissingSides = false } = {}) {
  const items = [];
  const frontFull = pickImage(note, "front", "full");
  const backFull = pickImage(note, "back", "full");
  const frontThumb = pickImage(note, "front", "thumbnail") || frontFull;
  const backThumb = pickImage(note, "back", "thumbnail") || backFull;

  const noteLabel = getNoteDisplayLabel(note);
  const frontItem = {
    alt: `${noteLabel} front`,
    kind: "front",
    label: "Front",
    src: frontFull || frontThumb,
    thumb: frontThumb || frontFull,
  };
  const backItem = {
    alt: `${noteLabel} back`,
    kind: "back",
    label: "Back",
    src: backFull || backThumb,
    thumb: backThumb || backFull,
  };

  if (frontItem.src || includeMissingSides) {
    items.push(frontItem);
  }

  if (backItem.src || includeMissingSides) {
    items.push(backItem);
  }

  if (!items.length) {
    items.push({
      alt: `${note.denomination} preview unavailable`,
      kind: "missing",
      label: "No image",
      src: null,
      thumb: null,
    });
  }

  return items;
}

// Zoom stops as multiples of the fitted image, not of its natural pixels. A
// scan that arrives much larger than the plate therefore steps up from the
// size the reader already sees instead of jumping straight to 100%.
const POPOVER_ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3, 4];
const ZOOM_EPSILON = 0.001;

function ImagePopover({
  alt,
  canGoNext,
  canGoPrevious,
  counterPosition,
  counterTotal,
  noteLabel,
  onClose,
  onJump,
  onNext,
  onPrevious,
  onPreviewEnd,
  onPreviewStart,
  placeholderText,
  src,
  thumb,
}) {
  const overlayRef = useRef(null);
  const imageRef = useRef(null);
  const imageWrapRef = useRef(null);
  const dragRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const requestSeqRef = useRef(0);
  const shownSeqRef = useRef(0);
  const keyHeldRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [displayedSrc, setDisplayedSrc] = useState(null);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoomScale, setZoomScale] = useState(0);
  const fullLoaded = Boolean(src) && displayedSrc === src;
  const showThumb = !displayedSrc && Boolean(thumb) && thumb !== src;

  const zoomed = zoomScale > 0;
  const fitScale =
    naturalSize.width > 0 && fitSize.width > 0
      ? fitSize.width / naturalSize.width
      : 0;
  const shownScale = zoomed ? zoomScale : fitScale;
  const scaledSize = {
    width: naturalSize.width * zoomScale,
    height: naturalSize.height * zoomScale,
  };
  const overflowX = Math.max(0, scaledSize.width - viewportSize.width);
  const overflowY = Math.max(0, scaledSize.height - viewportSize.height);
  const pannable = zoomed && (overflowX > 0 || overflowY > 0);
  const maxZoomScale = fitScale * POPOVER_ZOOM_LEVELS.at(-1);
  const canZoomIn =
    fullLoaded && fitScale > 0 && (!zoomed || zoomScale < maxZoomScale);
  const canZoomOut = fullLoaded && zoomed;

  // An axis with no overflow has nothing to pan, so it keeps the image
  // centred. Without this a zoomed plate smaller than the well would snap to
  // the top-left corner on its first step.
  function clampOffset(nextOffset, scale = zoomScale, size = viewportSize) {
    const scaledWidth = naturalSize.width * scale;
    const scaledHeight = naturalSize.height * scale;
    const minX = Math.min(0, size.width - scaledWidth);
    const minY = Math.min(0, size.height - scaledHeight);

    return {
      x:
        scaledWidth <= size.width
          ? (size.width - scaledWidth) / 2
          : Math.min(0, Math.max(minX, nextOffset.x)),
      y:
        scaledHeight <= size.height
          ? (size.height - scaledHeight) / 2
          : Math.min(0, Math.max(minY, nextOffset.y)),
    };
  }

  function measureImage() {
    const image = imageRef.current;

    if (!image) {
      return;
    }

    setNaturalSize({
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    });

    if (!zoomed) {
      const imageRect = image.getBoundingClientRect();

      if (imageRect.width && imageRect.height) {
        setFitSize({ width: imageRect.width, height: imageRect.height });
      }
    }
  }

  function wrapRect() {
    const rect = imageWrapRef.current?.getBoundingClientRect();

    return rect?.width && rect?.height ? rect : null;
  }

  function measureViewport() {
    const imageWrapRect = wrapRect();

    if (!imageWrapRect) {
      return;
    }

    const nextViewportSize = {
      width: imageWrapRect.width,
      height: imageWrapRect.height,
    };
    const zoomAnchor = zoomAnchorRef.current;

    setViewportSize(nextViewportSize);

    if (zoomAnchor) {
      zoomAnchorRef.current = null;
      setOffset(
        clampOffset(
          {
            x: nextViewportSize.width / 2 - zoomAnchor.x * zoomScale,
            y: nextViewportSize.height / 2 - zoomAnchor.y * zoomScale,
          },
          zoomScale,
          nextViewportSize,
        ),
      );
    }
  }

  function anchorInViewport(e) {
    const imageWrapRect = wrapRect();

    if (!imageWrapRect) {
      return null;
    }

    return {
      x: e.clientX - imageWrapRect.left,
      y: e.clientY - imageWrapRect.top,
    };
  }

  function liveViewportSize() {
    const imageWrapRect = wrapRect();

    return imageWrapRect
      ? { width: imageWrapRect.width, height: imageWrapRect.height }
      : viewportSize;
  }

  function resetZoom() {
    zoomAnchorRef.current = null;
    setZoomScale(0);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
  }

  function getNextZoomScale(direction) {
    const ladder = POPOVER_ZOOM_LEVELS.map((level) => fitScale * level);
    const currentScale = zoomed ? zoomScale : fitScale;

    if (direction > 0) {
      return (
        ladder.find((scale) => scale > currentScale + ZOOM_EPSILON) ??
        currentScale
      );
    }

    const lowerScale = [...ladder]
      .reverse()
      .find((scale) => scale < currentScale - ZOOM_EPSILON);

    return lowerScale ?? 0;
  }

  function zoomTo(nextScale, anchor = null) {
    if (!fullLoaded || !fitScale) {
      return;
    }

    if (!nextScale || nextScale <= fitScale + ZOOM_EPSILON) {
      resetZoom();
      return;
    }

    const viewport = liveViewportSize();
    const point = anchor ?? {
      x: viewport.width / 2,
      y: viewport.height / 2,
    };

    if (!zoomed) {
      // The zoomed plate has its own viewport, so remember the anchor in image
      // pixels and centre it after the layout settles, rather than pinning it
      // to the top-left corner.
      const fitOrigin = {
        x: (viewport.width - fitSize.width) / 2,
        y: (viewport.height - fitSize.height) / 2,
      };

      zoomAnchorRef.current = {
        x: (point.x - fitOrigin.x) / fitScale,
        y: (point.y - fitOrigin.y) / fitScale,
      };
      setZoomScale(nextScale);
      return;
    }

    const naturalPoint = {
      x: (point.x - offset.x) / zoomScale,
      y: (point.y - offset.y) / zoomScale,
    };

    setZoomScale(nextScale);
    setOffset(
      clampOffset(
        {
          x: point.x - naturalPoint.x * nextScale,
          y: point.y - naturalPoint.y * nextScale,
        },
        nextScale,
        viewport,
      ),
    );
  }

  function changeZoom(direction, anchor = null) {
    zoomTo(getNextZoomScale(direction), anchor);
  }

  function zoomIn() {
    changeZoom(1);
  }

  function zoomOut() {
    changeZoom(-1);
  }

  function toggleZoom(e) {
    if (zoomed) {
      resetZoom();
      return;
    }

    changeZoom(1, anchorInViewport(e));
  }

  function moveToNextImage() {
    resetZoom();
    onNext();
  }

  function moveToPreviousImage() {
    resetZoom();
    onPrevious();
  }

  // A held key repeats faster than slow machines decode, so repeats wait for
  // the current image. Otherwise the queued repeats keep paging after release.
  function stillDecoding(e) {
    return e.repeat && shownSeqRef.current < requestSeqRef.current;
  }

  function pageWithKey(e, move) {
    if (stillDecoding(e)) {
      e.preventDefault();
      return;
    }

    move();
  }

  function panBy(deltaX, deltaY) {
    if (!pannable) {
      return;
    }

    setOffset((currentOffset) =>
      clampOffset({
        x: currentOffset.x + deltaX,
        y: currentOffset.y + deltaY,
      }),
    );
  }

  function onImagePointerDown(e) {
    if (!pannable) {
      return;
    }

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      offset,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
    setIsDragging(true);
  }

  function onImagePointerMove(e) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }

    setOffset(
      clampOffset({
        x: drag.offset.x + e.clientX - drag.x,
        y: drag.offset.y + e.clientY - drag.y,
      }),
    );
  }

  function onImagePointerUp(e) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  }

  function onImageWheel(e) {
    if (!fullLoaded) {
      return;
    }

    e.preventDefault();
    changeZoom(e.deltaY < 0 ? 1 : -1, anchorInViewport(e));
  }

  useEffect(() => {
    resetZoom();
  }, [src]);

  // The popover is the nested dialog: focus moves into it on open, and the
  // slideshow behind it is inert (see the panel in Slideshow).
  useLayoutEffect(() => {
    overlayRef.current?.focus({ preventScroll: true });
  }, []);

  // The visible image only ever switches to a source that is already decoded,
  // so holding an arrow key never paints an empty frame. While the key is
  // held, earlier sources that finish still show, so the plates keep flowing,
  // but an older one never replaces a newer one. Once the key is released only
  // the latest source may paint, so the plates stop where the user let go.
  useLayoutEffect(() => {
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    const show = () => {
      const latest = seq === requestSeqRef.current;

      if (seq > shownSeqRef.current && (latest || keyHeldRef.current)) {
        shownSeqRef.current = seq;
        setDisplayedSrc(src || null);
      }
    };

    if (!src) {
      show();
      return;
    }

    const probe = new Image();
    probe.fetchPriority = "high";
    probe.src = src;

    if (probe.complete && probe.naturalWidth > 0) {
      show();
    } else if (typeof probe.decode === "function") {
      probe.decode().then(show, show);
    } else {
      probe.onload = show;
      probe.onerror = show;
    }
  }, [src]);

  useLayoutEffect(() => {
    if (!displayedSrc) {
      return undefined;
    }

    const imageWrap = imageWrapRef.current;

    if (!imageWrap) {
      return undefined;
    }

    function measure() {
      measureViewport();
      measureImage();
    }

    measure();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(imageWrap);

    return () => resizeObserver.disconnect();
  }, [displayedSrc, zoomScale]);

  useEffect(() => {
    if (!zoomScale) {
      return;
    }

    setOffset((currentOffset) => clampOffset(currentOffset));
  }, [overflowX, overflowY, zoomScale]);

  useEffect(() => {
    function release() {
      keyHeldRef.current = false;
    }

    window.addEventListener("keyup", release);
    window.addEventListener("blur", release);

    return () => {
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", release);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.defaultPrevented) {
        return;
      }

      if (trapTabKey(e, overlayRef.current)) {
        return;
      }

      const direction = directionOf(e);
      const modified = e.shiftKey || e.ctrlKey || e.metaKey;

      if (direction) {
        keyHeldRef.current = true;
      }

      // Ctrl, Cmd and Shift are interchangeable for the arrow intents. Handled
      // before the modifier guard below so the presses are not swallowed.
      if (direction && modified && !e.altKey) {
        if (pannable) {
          if (direction === "left") {
            panBy(overflowX * 0.05, 0);
          } else if (direction === "right") {
            panBy(-overflowX * 0.05, 0);
          } else if (direction === "up") {
            panBy(0, overflowY * 0.05);
          } else {
            panBy(0, -overflowY * 0.05);
          }
          e.preventDefault();
          return;
        }

        // Not pannable: horizontal presses fall back to paging, vertical ones
        // are inert.
        if (direction === "left") {
          pageWithKey(e, moveToPreviousImage);
        } else if (direction === "right") {
          pageWithKey(e, moveToNextImage);
        }
        return;
      }

      if (hasModifierPressed(e)) {
        return;
      }

      if (e.key === "Escape") {
        if (zoomed) {
          resetZoom();
          return;
        }

        onClose();
        return;
      }

      if (e.key === "+") {
        e.preventDefault();
        zoomIn();
        return;
      }

      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (direction === "right") {
        pageWithKey(e, moveToNextImage);
        return;
      }

      if (direction === "left") {
        pageWithKey(e, moveToPreviousImage);
        return;
      }

      if (e.key === "Home" || e.key === "End") {
        const moved = e.key === "Home" ? onPreviewStart?.() : onPreviewEnd?.();

        if (moved) {
          e.preventDefault();
          resetZoom();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    fitScale,
    fitSize,
    fullLoaded,
    naturalSize,
    offset,
    onClose,
    onNext,
    onPreviewEnd,
    onPreviewStart,
    onPrevious,
    overflowX,
    overflowY,
    pannable,
    viewportSize,
    zoomScale,
  ]);

  const imageWrapClassName = [
    "image-popover-image-wrap",
    zoomed ? "image-popover-image-wrap--zoomed" : null,
    pannable ? "image-popover-image-wrap--pannable" : null,
    isDragging ? "image-popover-image-wrap--dragging" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const imageStyle =
    zoomed && scaledSize.width && scaledSize.height
      ? {
          height: `${scaledSize.height}px`,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          width: `${scaledSize.width}px`,
        }
      : undefined;
  const zoomPercent =
    fullLoaded && shownScale ? Math.round(shownScale * 100) : 0;
  const atActualSize = zoomed && Math.abs(zoomScale - 1) < ZOOM_EPSILON;

  return (
    <div
      aria-label="Image preview"
      aria-modal="true"
      className="image-popover-overlay"
      onClick={onClose}
      ref={overlayRef}
      role="dialog"
      tabIndex={-1}
    >
      <div
        className={`image-popover-content${zoomed ? " image-popover-content--zoomed" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="image-popover-topbar">
          <div className="image-popover-meta">
            <p className="eyebrow">Preview</p>
            <p className="image-popover-note-label">{noteLabel}</p>
          </div>
          <div className="image-popover-actions">
            <div
              aria-label="Image zoom"
              className="image-popover-zoom"
              role="group"
            >
              <button
                aria-pressed={!zoomed}
                className="image-popover-zoom-button"
                disabled={!fullLoaded || !zoomed}
                onClick={resetZoom}
                title="Fit the image to the plate"
                type="button"
              >
                Fit
              </button>
              <button
                aria-pressed={atActualSize}
                className="image-popover-zoom-button"
                disabled={
                  !fullLoaded ||
                  !fitScale ||
                  fitScale >= 1 - ZOOM_EPSILON
                }
                onClick={() => zoomTo(1)}
                title="Show the image at 100%"
                type="button"
              >
                100%
              </button>
              <button
                aria-label="Zoom out"
                className="image-popover-zoom-button image-popover-zoom-step"
                disabled={!canZoomOut}
                onClick={zoomOut}
                title="Zoom out (-)"
                type="button"
              >
                &minus;
              </button>
              <output
                aria-label="Zoom level"
                aria-live="polite"
                className="image-popover-zoom-level"
                title="Current zoom level"
              >
                {zoomPercent ? `${zoomPercent}%` : "Fit"}
              </output>
              <button
                aria-label="Zoom in"
                className="image-popover-zoom-button image-popover-zoom-step"
                disabled={!canZoomIn}
                onClick={zoomIn}
                title="Zoom in (+)"
                type="button"
              >
                +
              </button>
            </div>
            <NoteCounter
              jumpLabel="Image position"
              onJump={onJump}
              position={counterPosition}
              showArrows={false}
              total={counterTotal}
              variant="dark"
            />
            <button
              aria-label="Close preview"
              className="icon-link icon-link--on-dark image-popover-close"
              data-shortcut="Esc"
              onClick={onClose}
              title="Close preview"
              type="button"
            >
              Close
            </button>
          </div>
        </div>

        <div className="image-popover-stage">
          <button
            aria-label="Show previous image"
            className="arrow-button image-popover-arrow"
            disabled={!canGoPrevious}
            onClick={moveToPreviousImage}
            type="button"
          >
            <span aria-hidden="true">&larr;</span>
          </button>

          <div className={imageWrapClassName} ref={imageWrapRef}>
            {src ? (
              <>
                {displayedSrc ? (
                  <img
                    alt={alt}
                    className="image-popover-full"
                    decoding="sync"
                    onDoubleClick={toggleZoom}
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={measureImage}
                    onPointerCancel={onImagePointerUp}
                    onPointerDown={onImagePointerDown}
                    onPointerMove={onImagePointerMove}
                    onPointerUp={onImagePointerUp}
                    onWheel={onImageWheel}
                    ref={imageRef}
                    src={displayedSrc}
                    style={imageStyle}
                  />
                ) : null}
                {showThumb ? (
                  <img
                    alt=""
                    aria-hidden="true"
                    className="image-popover-thumb"
                    src={thumb}
                  />
                ) : null}
              </>
            ) : (
              <div className="image-popover-empty-state">
                <p className="eyebrow">No preview</p>
                <p>{placeholderText}</p>
              </div>
            )}
          </div>

          <button
            aria-label="Show next image"
            className="arrow-button image-popover-arrow"
            disabled={!canGoNext}
            onClick={moveToNextImage}
            type="button"
          >
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Slideshow({
  currentIndex,
  keyboardDisabled = false,
  notes,
  onAdd,
  onChangeIndex,
  onClose,
  onCopy,
  onEdit,
  onJump,
  onJumpPreview,
  onClosePreview,
  onMovePreview,
  onOpenPreview,
  onPreviewEnd,
  onPreviewStart,
  previewKind = null,
  readOnly = false,
}) {
  const note = notes[currentIndex];
  const screenRef = useRef(null);
  // The thumbnail the popover was opened from, so closing it returns the
  // keyboard to that control rather than the room's section.
  const previewTriggerRef = useRef(null);
  const wasPreviewRef = useRef(Boolean(previewKind));

  // The open note's two faces, used by the slide plates, the popover, and the
  // keyboard hand-off. One derivation per note change.
  const previewItems = useMemo(
    () => (note ? getPreviewItems(note, { includeMissingSides: true }) : []),
    [note],
  );

  // The flattened image sequence the popover pages through: front/back for
  // every note, in slide order. One memo drives the counters and the
  // neighbour prefetches instead of recomputing the walk per render.
  const previewSequence = useMemo(() => {
    const sequence = [];

    notes.forEach((entry) => {
      getPreviewItems(entry, { includeMissingSides: true }).forEach((item) => {
        sequence.push({ ...item, note: entry });
      });
    });

    return sequence;
  }, [notes]);
  const previewIndex =
    previewKind && note
      ? previewSequence.findIndex(
          (item) => item.note.id === note.id && item.kind === previewKind,
        )
      : -1;
  const previewItem = previewIndex >= 0 ? previewSequence[previewIndex] : null;

  // The next/previous slides are what a held arrow key reaches for. Preload
  // their 500px thumbnails at idle: cheap enough that a walk is instant, and
  // the visible slide never waits behind them.
  const neighbouringThumbs = useMemo(() => {
    const count = notes.length;

    if (count < 2) {
      return [];
    }

    const urls = [];
    const neighbours = new Set([
      notes[(currentIndex + 1) % count],
      notes[(currentIndex - 1 + count) % count],
    ]);

    neighbours.forEach((entry) => {
      if (!entry) {
        return;
      }

      getPreviewItems(entry).forEach((item) => {
        if (item.thumb) {
          urls.push(item.thumb);
        }
      });
    });

    return urls;
  }, [currentIndex, notes]);
  useImagePreload(neighbouringThumbs, { cache: "thumbnail" });

  // The current note's full plates are what Enter opens. Let the slide paint
  // first, then warm them so keyboard users get the same instant popover as a
  // pointer hovering a thumbnail.
  const currentFullImages = useMemo(
    () => previewItems.flatMap((item) => (item.src ? [item.src] : [])),
    [previewItems],
  );
  useImagePreload(currentFullImages, { delay: 300 });

  // While the popover is open, warm the previous/next plate in its sequence.
  // The current plate is already loading, so one step either way covers a
  // normal arrow press without fetching the whole collection.
  const neighbouringPreviewImages = useMemo(
    () => neighbouringImageSources(previewSequence, previewIndex),
    [previewIndex, previewSequence],
  );
  useImagePreload(neighbouringPreviewImages, { delay: 120 });

  function preloadPreviewItem(item) {
    if (item?.src) {
      preloadImage(item.src, { priority: "high" });
    }
  }

  function moveSlideshow(offset) {
    onChangeIndex(
      (current) => (current + offset + notes.length) % notes.length,
    );
  }

  async function handleCopyNoteDetails() {
    const clipboardValue = formatNoteAsTsvRow(note);

    try {
      await copyTextToClipboard(clipboardValue);
      onCopy?.(null);
    } catch {
      onCopy?.("Could not copy note details to clipboard.");
    }
  }

  useEffect(() => {
    const wasPreview = wasPreviewRef.current;
    wasPreviewRef.current = Boolean(previewKind);

    if (keyboardDisabled || previewKind) {
      return undefined;
    }

    // Focus moves into the room when it opens, and again when a nested layer
    // (the Image popover or the Note editor) hands the keyboard back. Closing
    // the popover returns to the thumbnail that opened it when that control is
    // still on screen.
    const screen = screenRef.current;
    const active = document.activeElement;

    if (!screen || (active instanceof HTMLElement && screen.contains(active))) {
      return undefined;
    }

    const trigger = wasPreview ? previewTriggerRef.current : null;
    previewTriggerRef.current = null;

    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
      return undefined;
    }

    screen.focus({ preventScroll: true });
    return undefined;
  }, [keyboardDisabled, previewKind]);

  useEffect(() => {
    if (keyboardDisabled) {
      return undefined;
    }

    function onKeyDown(event) {
      if (previewKind) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      // Tab stays in the room; a sibling dialog keeps its own walk.
      if (trapTabKey(event, screenRef.current)) {
        return;
      }

      // The editable counter in the top bar owns its own keys while focused.
      if (isEditableElement(event.target)) {
        return;
      }

      const direction = directionOf(event);

      // A modified arrow (or h/j/k/l alias) is inert and left for the
      // platform. Only the arrows are affected: a bare Shift must not swallow
      // Shift+Enter/Space/Home/End, which keep their own meaning.
      if (direction && (hasModifierPressed(event) || event.shiftKey)) {
        return;
      }

      if (hasModifierPressed(event)) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
        return;
      }

      // A focused control owns Enter/Space: the browser activates it instead
      // of the slideshow opening the preview.
      if (
        (event.key === "Enter" || event.key === " ") &&
        isNativeControl(event.target)
      ) {
        return;
      }

      if (event.key === "a" && note && !readOnly) {
        event.preventDefault();
        onAdd?.(note.id);
        return;
      }

      if (event.key === "e" && note && !readOnly) {
        event.preventDefault();
        onEdit?.(note.id);
        return;
      }

      if (direction === "right") {
        moveSlideshow(1);
        return;
      }

      if (direction === "left") {
        moveSlideshow(-1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        const targetIndex = event.key === "Home" ? 0 : notes.length - 1;

        if (targetIndex === currentIndex) {
          return;
        }

        event.preventDefault();
        onChangeIndex(targetIndex);
        return;
      }

      if (direction === "down" || direction === "up") {
        const screen = screenRef.current;

        if (screen && screen.scrollHeight > screen.clientHeight + 1) {
          event.preventDefault();
          screen.scrollBy({
            top: direction === "down" ? 80 : -80,
          });
        }
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && note) {
        const openableItem = previewItems.find(
          (item) => item.kind === "front" || item.kind === "back",
        );

        if (openableItem) {
          event.preventDefault();
          onOpenPreview?.(note.id, openableItem.kind);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentIndex,
    keyboardDisabled,
    note,
    notes.length,
    onAdd,
    onClose,
    onEdit,
    onOpenPreview,
    previewItems,
    previewKind,
    readOnly,
  ]);

  if (!notes.length) {
    return null;
  }

  const scrapedDetailEntries = getScrapedDetailEntries(note);
  const { curated: curatedScrapedDetails, more: moreScrapedDetails } =
    getScrapedDetailSections(scrapedDetailEntries);
  const hasSlideImages = previewItems.some((item) => item.thumb);
  const totalPreviewCount = previewSequence.length;
  const previewSequenceIndex = previewItem ? previewIndex + 1 : 0;
  const scrapePanelTitle = getScrapePanelTitle(note);
  const denomination = String(note?.denomination ?? "").trim();
  const noteAnnouncement = note
    ? `note ${currentIndex + 1} of ${notes.length}, ${denomination || "Untitled note"}`
    : "";

  // While an editor overlay is open the slideshow is a backdrop: it keeps
  // rendering, but `inert` takes its controls out of the tab order and stops
  // clicks, so a stray Tab cannot reach behind the modal and act (closing the
  // slideshow or typing a counter jump) while the editor holds unsaved work.
  // The section is the room's dialog; the panel steps aside (but the nested
  // Image popover does not) while a plate is enlarged.
  return (
    <section
      aria-label="Note slideshow"
      aria-modal={previewItem ? undefined : "true"}
      className="slideshow-screen slideshow-screen--overlay"
      inert={keyboardDisabled}
      ref={screenRef}
      role="dialog"
      tabIndex={-1}
    >
      <span aria-live="polite" className="slideshow-announcer">
        {noteAnnouncement}
      </span>

      {previewItem && note && (
        <ImagePopover
          alt={previewItem.alt}
          canGoNext={totalPreviewCount > 1}
          canGoPrevious={totalPreviewCount > 1}
          counterPosition={previewSequenceIndex}
          counterTotal={totalPreviewCount}
          noteLabel={`${getNoteDisplayLabel(note)} - ${previewItem.label}`}
          onClose={() => onClosePreview?.(note.id)}
          onJump={onJumpPreview}
          onNext={() => onMovePreview?.(1)}
          onPrevious={() => onMovePreview?.(-1)}
          onPreviewEnd={onPreviewEnd}
          onPreviewStart={onPreviewStart}
          placeholderText={`No scraped ${previewItem.label.toLowerCase()} image exists for this note yet.`}
          src={previewItem.src}
          thumb={previewItem.thumb}
        />
      )}

      <div className="slideshow-panel" inert={Boolean(previewItem)}>
        <div className="slideshow-topbar">
          <div className="slideshow-topbar-actions">
            <NoteCounter
              jumpLabel="Note position"
              onJump={onJump}
              position={currentIndex + 1}
              showArrows={false}
              total={notes.length}
              variant="dark"
            />
            <button
              aria-label="Copy note details"
              className="icon-link icon-link--on-dark"
              onClick={handleCopyNoteDetails}
              title="Copy note details"
              type="button"
            >
              <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                <rect
                  fill="none"
                  height="10"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="10"
                  x="9"
                  y="9"
                />
                <rect
                  fill="none"
                  height="10"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="10"
                  x="5"
                  y="5"
                />
              </svg>
            </button>
            {readOnly ? null : (
              <>
                <button
                  aria-label="Add note"
                  className="icon-link icon-link--on-dark"
                  onClick={() => onAdd?.(note.id)}
                  title="Add note before this one (a)"
                  type="button"
                >
                  Add note
                </button>
                <button
                  aria-label="Edit note"
                  className="icon-link icon-link--on-dark"
                  onClick={() => onEdit?.(note.id)}
                  title="Edit note (e)"
                  type="button"
                >
                  Edit note
                </button>
              </>
            )}
            <button
              aria-label="Close slideshow"
              className="icon-link icon-link--on-dark"
              data-shortcut="Esc"
              onClick={onClose}
              title="Close slideshow"
              type="button"
            >
              Close
            </button>
          </div>
        </div>
  
        <div className="slideshow-layout">
          <button
            aria-label="Previous note"
            className="arrow-button"
            onClick={() => moveSlideshow(-1)}
            title="Previous note (←)"
            type="button"
          >
            <span aria-hidden="true">&larr;</span>
          </button>
  
          <div className="slide-card">
            <div className="slide-images">
              {hasSlideImages ? (
                previewItems.map((item) => (
                  <button
                    key={item.kind}
                    aria-label={`Enlarge ${item.label.toLowerCase()} image`}
                    className="slide-thumb-btn"
                    onClick={(event) => {
                      previewTriggerRef.current = event.currentTarget;
                      onOpenPreview?.(note.id, item.kind);
                    }}
                    onFocus={() => preloadPreviewItem(item)}
                    onMouseEnter={() => preloadPreviewItem(item)}
                    title="Click to enlarge"
                    type="button"
                  >
                    {item.thumb ? (
                      <img alt={item.alt} decoding="async" src={item.src} />
                    ) : (
                      <div className="slide-thumb-placeholder">
                        No scraped image yet
                      </div>
                    )}
                    <span className="slide-thumb-label">{item.label}</span>
                  </button>
                ))
              ) : (
                <div className="slide-empty-state">
                  <p className="eyebrow">No images</p>
                  <p>
                    {readOnly
                      ? "This note has no images."
                      : "No images yet. Press E to edit this note and add the front and back."}
                  </p>
                </div>
              )}
            </div>
  
            <div className="slide-meta">
              <div>
                <p className="eyebrow">
                  {note.grading_company || "Collection note"}
                </p>
                <h1>{getNoteTitle(note)}</h1>
                <p className="slide-issue">{note.issue_date}</p>
              </div>
              <div className="detail-grid">
                <p>
                  <strong>Catalog:</strong> {note.catalog_number || "-"}
                </p>
                <p>
                  <strong>Grade:</strong>{" "}
                  {note.grade ? (
                    <span
                      className={`slide-grade slide-grade--${gradeTier(note.grade)}`}
                    >
                      {note.grade}
                    </span>
                  ) : (
                    "-"
                  )}
                </p>
                <p>
                  <strong>Serial:</strong> {note.serial || "-"}
                </p>
                <p>
                  <strong>Watermark:</strong> {note.watermark || "-"}
                </p>
              </div>
              {scrapedDetailEntries.length ? (
                <div className="scraped-details-panel">
                  <p className="eyebrow">{scrapePanelTitle}</p>
                  {curatedScrapedDetails.length ? (
                    <div className="scraped-details-grid scraped-details-grid--curated">
                      {curatedScrapedDetails.map(([label, value]) => {
                        const isComment = label === "Comment";

                        return (
                          <p
                            className={
                              isComment ? "scraped-detail-comment" : undefined
                            }
                            key={label}
                            title={isComment ? String(value) : undefined}
                          >
                            <strong>{label}:</strong> {String(value)}
                          </p>
                        );
                      })}
                    </div>
                  ) : null}
                  {moreScrapedDetails.length ? (
                    <details className="scraped-details-more">
                      <summary>
                        Scraped details · {moreScrapedDetails.length}
                      </summary>
                      <div className="scraped-details-grid">
                        {moreScrapedDetails.map(([key, value]) => {
                          const isSource = key === "source_url";

                          return (
                            <p
                              className={
                                isSource ? "scraped-detail-source" : undefined
                              }
                              key={key}
                            >
                              <strong>
                                {isSource ? "Source" : formatScrapedLabel(key)}:
                              </strong>{" "}
                              {isSource && isHttpUrl(value) ? (
                                <a
                                  href={String(value)}
                                  rel="noreferrer"
                                  target="_blank"
                                  title={String(value)}
                                >
                                  {getSourceHost(value)}
                                </a>
                              ) : (
                                String(value)
                              )}
                            </p>
                          );
                        })}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
              <p className="slide-notes">{note.notes || "No extra notes."}</p>
              <div className="tag-list">
                {note.tags.map((tag) => (
                  <span className="tag" key={tag.id || tag.name}>
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
  
          <button
            aria-label="Next note"
            className="arrow-button"
            onClick={() => moveSlideshow(1)}
            title="Next note (→)"
            type="button"
          >
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>
    </section>
  );
}

export { ImagePopover, Slideshow };
