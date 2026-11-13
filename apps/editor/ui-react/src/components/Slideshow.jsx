import {
  useCallback,
  useEffect,
  useId,
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
  getPreloadedImage,
  neighbouringImageSources,
  preloadImage,
  useImagePreload,
} from "../lib/imagePreload.js";
import { gradeTier } from "../lib/tableColumns.js";
import { filterFieldLabel } from "../lib/tableFilters.js";
import { usePacedMove } from "../lib/usePacedMove.js";
import { NoteCounter } from "./NoteCounter.jsx";
import { useToastHost } from "./Toast.jsx";

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

// A neighbour turn names the note the way a catalogue page does: the
// denomination and its issue year, not the internal index or the catalog
// number the entry column already carries.
function getNeighbourLabel(note) {
  const denomination = String(note?.denomination ?? "").trim();
  const issueDate = String(note?.issue_date ?? "").trim();

  if (denomination && issueDate) {
    return `${denomination} ${issueDate}`;
  }

  return denomination || issueDate || "Untitled note";
}

// The final segment of an image URL, for naming a file to the reader. Plates
// and popover scans both carry version and preview queries, and the full path
// is noise: the file name is the one detail that helps a collector find the
// scan on disk. An unknown name stays empty; callers that must name something
// pass their own fallback.
function fileNameFromPath(path) {
  const name =
    String(path ?? "")
      .split(/[?#]/)[0]
      .split("/")
      .filter(Boolean)
      .at(-1) ?? "";

  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// A missing value reads as the table's muted dash, so an absent field never
// looks like a different kind of thing in the room than it does in a row.
function NoteValue({ value }) {
  const text = String(value ?? "").trim();

  return text ? text : <span className="muted">-</span>;
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

// The slide asks for a right-sized WebP preview (the server caches it), not
// the multi-MB original the popover opens. The width also makes the preview a
// distinct cache entry from the full scan.
const SLIDE_PREVIEW_WIDTH = 1600;

function versionedImagePath(path, version, width = null) {
  if (!path) {
    return null;
  }

  const separator = path.includes("?") ? "&" : "?";
  const params = [];

  if (version) {
    params.push(`v=${encodeURIComponent(version)}`);
  }

  if (width) {
    params.push(`w=${width}`);
  }

  return params.length ? `${path}${separator}${params.join("&")}` : path;
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

function pickImage(note, type, variant = "full", width = null) {
  const imagePath =
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(imagePath, note.updated_at, width);
}

function getPreviewItems(note, { includeMissingSides = false } = {}) {
  const items = [];
  const frontFull = pickImage(note, "front", "full");
  const backFull = pickImage(note, "back", "full");
  const frontThumb = pickImage(note, "front", "thumbnail") || frontFull;
  const backThumb = pickImage(note, "back", "thumbnail") || backFull;
  const frontSlide =
    pickImage(note, "front", "full", SLIDE_PREVIEW_WIDTH) || frontThumb;
  const backSlide =
    pickImage(note, "back", "full", SLIDE_PREVIEW_WIDTH) || backThumb;

  const noteLabel = getNoteDisplayLabel(note);
  const frontItem = {
    alt: `${noteLabel}, Front`,
    kind: "front",
    label: "Front",
    // `src` stays the full scan for the popover; `slide` is the right-sized
    // plate the room paints.
    src: frontFull || frontThumb,
    slide: frontSlide || frontFull,
    thumb: frontThumb || frontFull,
  };
  const backItem = {
    alt: `${noteLabel}, Back`,
    kind: "back",
    label: "Back",
    src: backFull || backThumb,
    slide: backSlide || backFull,
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
      slide: null,
      src: null,
      thumb: null,
    });
  }

  return items;
}

// The slide paints the 500px thumbnail immediately and only reveals the crisp
// preview once it has loaded. A note walk therefore never waits on a large
// decode, but the settled plate is still sharp. While the walk is moving the
// crisp layer is not even mounted: every transient note would otherwise start
// two preview downloads that the next key press throws away. The loaded
// source is stored rather than a boolean, so a new note resets the layer
// without an effect and a late load from the previous note cannot win.
//
// A file that is gone (an archive moved between machines, a scrape whose image
// never landed) keeps the plate's geometry and names what is missing instead
// of leaving the browser's broken-image glyph inside a mat.
function SlidePlate({
  alt,
  deferFull = false,
  fileName,
  failed = false,
  onError,
  paused = false,
  src,
  thumb,
}) {
  const [loadedFullSrc, setLoadedFullSrc] = useState(null);
  const [failedFullSrc, setFailedFullSrc] = useState(null);
  const fullSrc = src && src !== thumb ? src : null;
  const fullLoaded = Boolean(fullSrc) && loadedFullSrc === fullSrc;
  const fullBroken = Boolean(fullSrc) && failedFullSrc === fullSrc;
  // The popover covers the room, so a full scan still in flight behind it only
  // competes with the plate the reader opened. Once loaded, keep the layer so
  // closing the preview returns to a settled plate.
  const showFull =
    Boolean(fullSrc) &&
    !fullBroken &&
    (fullLoaded || (!deferFull && !paused));

  if (failed) {
    return (
      <span className="slide-plate slide-plate--unavailable">
        <span className="slide-plate-unavailable-title">Image unavailable</span>
        <span className="slide-plate-unavailable-file">{fileName}</span>
      </span>
    );
  }

  return (
    <span className="slide-plate">
      <img
        alt={alt}
        className="slide-plate-thumb"
        decoding="async"
        onError={onError}
        src={thumb}
      />
      {showFull ? (
        <>
          <img
            alt=""
            aria-hidden="true"
            className={`slide-plate-full${fullLoaded ? " slide-plate-full--loaded" : ""}`}
            decoding="async"
            fetchPriority="low"
            key={fullSrc}
            onError={() => setFailedFullSrc(fullSrc)}
            onLoad={() => setLoadedFullSrc(fullSrc)}
            src={fullSrc}
          />
          {fullLoaded ? null : (
            <span aria-hidden="true" className="image-loading-spinner" />
          )}
        </>
      ) : null}
    </span>
  );
}

// Zoom stops as multiples of the fitted image, not of its natural pixels. A
// scan that arrives much larger than the plate therefore steps up from the
// size the reader already sees instead of jumping straight to 1:1.
const POPOVER_ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3, 4];
const ZOOM_EPSILON = 0.001;

// Measurements mostly repeat the size already in state, so returning the
// current object keeps React from re-rendering for an unchanged rect.
function sameSize(left, right) {
  return left.width === right.width && left.height === right.height;
}

const POPOVER_SIDES = [
  { kind: "front", label: "Front" },
  { kind: "back", label: "Back" },
];

// The 1:1 segment asks one question in four names: has the scan a measured
// fit, is that fit already actual size, has the reader zoomed off it, and what
// should the segment say. One state keeps its pressed mark, its inert case and
// its title in step.
function getActualSizeState({ fitScale, fullLoaded, hasImage, scale, zoomed }) {
  const pressed = zoomed && Math.abs(scale - 1) < ZOOM_EPSILON;

  if (!hasImage) {
    return { inert: true, pressed, title: "Image unavailable" };
  }

  if (!fullLoaded) {
    return { inert: true, pressed, title: "The image is still loading" };
  }

  if (fitScale <= 0) {
    return {
      inert: true,
      pressed,
      title: "The image's size is not known yet",
    };
  }

  const atFit = fitScale >= 1 - ZOOM_EPSILON;
  // A fit that is already 1:1 leaves the stop nothing to do until the reader
  // zooms past it; then it returns to actual size instead of sitting dead.
  const inert = atFit && !zoomed;

  return {
    inert,
    pressed,
    title:
      inert || pressed
        ? "The image already shows one image pixel per screen pixel"
        : "Show the image at one image pixel per screen pixel",
  };
}

function ImagePopover({
  alt,
  availableSides = [],
  canGoNext,
  canGoPrevious,
  counterPosition,
  counterTotal,
  noteKey,
  noteLabel,
  onClose,
  onEdit,
  onJump,
  onNext,
  onPrevious,
  onPreviewEnd,
  onPreviewStart,
  onSelectSide,
  placeholderText,
  side = null,
  src,
  thumb,
}) {
  const titleId = useId();
  const statusId = useId();
  const escapeHintId = useId();
  const overlayRef = useRef(null);
  const imageRef = useRef(null);
  const imageWrapRef = useRef(null);
  const dragRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const requestSeqRef = useRef(0);
  const shownSeqRef = useRef(0);
  const keyHeldRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [displayedSrc, setDisplayedSrc] = useState(null);
  const [failedImage, setFailedImage] = useState(null);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoomScale, setZoomScale] = useState(0);
  // Panning updates the offset on every pointer move; the key handler reads
  // it through a ref so its window listener is not torn down and re-added for
  // each of those renders.
  useLayoutEffect(() => {
    offsetRef.current = offset;
  }, [offset]);
  const hasSource = Boolean(src);
  const fullLoaded = hasSource && displayedSrc === src;
  // A scan whose row exists but whose file has gone renders the browser's
  // broken-image glyph. Folding that into the same missing-image state as an
  // absent side means the collector sees one honest answer either way. The
  // failed source is remembered by URL, so paging to another image clears it,
  // and the failing file is kept so the quiet line names the real casualty.
  const imageFailed = hasSource && failedImage?.src === src;
  const hasImage = hasSource && !imageFailed;
  const zoomed = hasImage && zoomScale > 0;
  // Until the target full scan is ready, show its thumbnail over the plate
  // already on screen. Paging then answers the key immediately instead of
  // holding a stale image while a multi-MB decode runs.
  const showThumb =
    hasImage && !fullLoaded && !zoomed && Boolean(thumb) && thumb !== src;

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
  // A broken scan still shows the instrument, but every control in it is
  // inert: there are no pixels to step through.
  const canZoomIn =
    hasImage &&
    fullLoaded &&
    fitScale > 0 &&
    (!zoomed || zoomScale < maxZoomScale);
  const canZoomOut = hasImage && zoomed;
  const actualSize = getActualSizeState({
    fitScale,
    fullLoaded,
    hasImage,
    scale: zoomScale,
    zoomed,
  });

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

  // The fitted box is what the plate occupies in the fit view. While the
  // popover is zoomed, the inline scaled size and the zoomed wrap's rules hide
  // it, so lift both for one synchronous read. Without this, switching from
  // one face to the other would keep the old face's fit, and with it a wrong
  // zoom ladder and 1:1 stop.
  function measureFitBox(image, natural) {
    const wrap = imageWrapRef.current;

    // Without the wrap there is no way to restore the zoomed layout, and the
    // rect would be the scaled plate, not the fit.
    if (zoomed && !wrap) {
      return;
    }

    const inlineWidth = image.style.width;
    const inlineHeight = image.style.height;

    let imageRect;

    if (zoomed) {
      // Lift the zoomed wrap rules and the inline scaled size for one
      // synchronous read, then put both back exactly as React left them.
      image.style.width = "";
      image.style.height = "";

      try {
        wrap.classList.remove("image-popover-image-wrap--zoomed");
        imageRect = image.getBoundingClientRect();
      } finally {
        wrap.classList.add("image-popover-image-wrap--zoomed");
        image.style.width = inlineWidth;
        image.style.height = inlineHeight;
      }
    } else {
      imageRect = image.getBoundingClientRect();
    }

    if (imageRect.width && imageRect.height) {
      const fitted = {
        width: imageRect.width,
        height: imageRect.height,
      };

      // A face whose fit is larger than the retained zoom would leave the
      // plate below its own fit. The zoom view is never smaller than the fit,
      // so clamp the retained scale up to this face's fit rather than dropping
      // the zoom: the front/back switch keeps it.
      const faceFitScale =
        natural.width > 0 ? fitted.width / natural.width : 0;

      if (
        zoomed &&
        faceFitScale > 0 &&
        zoomScale < faceFitScale - ZOOM_EPSILON
      ) {
        setZoomScale(faceFitScale);
      }

      setFitSize((current) => (sameSize(current, fitted) ? current : fitted));
    }
  }

  function measureImage() {
    const image = imageRef.current;

    if (!image) {
      return;
    }

    const natural = {
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    };
    setNaturalSize((current) =>
      sameSize(current, natural) ? current : natural,
    );
    measureFitBox(image, natural);
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

    setViewportSize((current) =>
      sameSize(current, nextViewportSize) ? current : nextViewportSize,
    );

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
    if (!hasImage) {
      return;
    }

    if (!nextScale || nextScale <= fitScale + ZOOM_EPSILON) {
      resetZoom();
      return;
    }

    // A step up needs this scan's measured fit; a step back only needs the
    // zoom already held, so it still works while the next scan loads.
    if (!fullLoaded || !fitScale) {
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

    const currentOffset = offsetRef.current;
    const naturalPoint = {
      x: (point.x - currentOffset.x) / zoomScale,
      y: (point.y - currentOffset.y) / zoomScale,
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

  function sideAvailable(kind) {
    return availableSides.includes(kind);
  }

  // A side with no image keeps its toggle visible but inert: `aria-disabled`
  // rather than `disabled` so the pressed state stays readable to assistive
  // tech. The caller owns how the switch moves through its sequence.
  function selectSide(kind) {
    if (kind === side || !sideAvailable(kind) || !onSelectSide) {
      return;
    }

    onSelectSide(kind);
  }

  // A broken <img> records the source it was actually asked to paint, so a
  // late error from the previous page cannot mark the incoming one missing.
  // Only the current page's own scan or thumbnail can fail it, and the
  // failure is keyed to the canonical full scan the empty state names.
  function failImage(source) {
    if (!source || (source !== src && source !== thumb)) {
      return;
    }

    setFailedImage({ file: fileNameFromPath(source), src: src || null });
  }

  // The scrim steps back to Fit first, exactly like the first Escape, and only
  // closes the preview when there is no zoom left to unwind.
  function clickScrim() {
    if (zoomed) {
      resetZoom();
      return;
    }

    onClose();
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

  // A wheel over the plate zooms at the pointer. The overlay is a fixed room,
  // so scrolling it would only walk the page behind: the wheel belongs to the
  // image, and the native non-passive listener is what cancels the default.
  function onImageWheel(e) {
    e.preventDefault();

    if (!fullLoaded) {
      return;
    }

    changeZoom(e.deltaY < 0 ? 1 : -1, anchorInViewport(e));
  }

  // React delegates `wheel` through a passive root listener, where
  // `preventDefault()` is a no-op (and warns). The image owns a native,
  // non-passive listener instead so zooming does not also scroll the overlay.
  // The listener is attached once per painted image and reads the handler
  // through a ref, so it is never torn down and re-added while zooming.
  const onImageWheelRef = useRef(onImageWheel);
  useLayoutEffect(() => {
    onImageWheelRef.current = onImageWheel;
  }, [onImageWheel]);

  useEffect(() => {
    const image = imageRef.current;

    if (!image) {
      return undefined;
    }

    function handleWheel(e) {
      onImageWheelRef.current(e);
    }

    image.addEventListener("wheel", handleWheel, { passive: false });

    return () => image.removeEventListener("wheel", handleWheel);
  }, [displayedSrc]);

  // The zoom belongs to the note, not the face: a note's front and back keep
  // the chosen scale, while opening another note returns the popover to Fit.
  // A layout effect, not a passive one: the displayed image swaps before paint,
  // so a cross-note page must not paint the old note's scale first.
  useLayoutEffect(() => {
    resetZoom();
  }, [noteKey]);

  // The popover is the nested dialog: focus moves into it on open, and the
  // slideshow behind it is inert (see the panel in Slideshow).
  useLayoutEffect(() => {
    overlayRef.current?.focus({ preventScroll: true });
  }, []);

  // Paging onto a side with no image removes the zoom cluster. If one of its
  // buttons held focus, the dialog would be left with focus on <body>: pull it
  // back to the overlay instead. Controls that survive the switch keep focus.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;

    if (hasImage || !overlay) {
      return;
    }

    const active = document.activeElement;

    if (!(active instanceof Node) || !overlay.contains(active)) {
      overlay.focus({ preventScroll: true });
    }
  }, [hasImage]);

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

    // The neighbour prefetch may already hold this URL. Reuse its element so
    // paging waits on the one load already in flight instead of starting a
    // second probe, and paint immediately when it has finished.
    const warmed = getPreloadedImage(src);

    if (warmed?.complete && warmed.naturalWidth > 0) {
      show();
      return;
    }

    const probe =
      warmed && (warmed.complete || typeof warmed.decode === "function")
        ? warmed
        : new Image();

    probe.fetchPriority = "high";

    if (probe !== warmed) {
      probe.src = src;
    }

    if (probe.complete && probe.naturalWidth > 0) {
      show();
    } else if (typeof probe.decode === "function") {
      probe.decode().then(show, show);
    } else {
      probe.onload = show;
      probe.onerror = show;
    }
  }, [src]);

  // Measuring is only needed for zoom and the level readout, so let the new
  // plate paint first. A layout effect here forced a rect read and a second
  // synchronous render before every page could appear.
  useEffect(() => {
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
          pageWithKey(e, onPrevious);
        } else if (direction === "right") {
          pageWithKey(e, onNext);
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
        pageWithKey(e, onNext);
        return;
      }

      if (direction === "left") {
        pageWithKey(e, onPrevious);
        return;
      }

      if (e.key === "Home" || e.key === "End") {
        // A jump across notes resets through the noteKey effect; a jump to the
        // same note's other face keeps the zoom like paging does.
        const moved = e.key === "Home" ? onPreviewStart?.() : onPreviewEnd?.();

        if (moved) {
          e.preventDefault();
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
    showThumb ? "image-popover-image-wrap--warming" : null,
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
    hasImage && fullLoaded && shownScale ? Math.round(shownScale * 100) : 0;
  const sideLabel =
    POPOVER_SIDES.find((option) => option.kind === side)?.label ?? null;
  const fileName = imageFailed ? failedImage.file : "";
  const positionAnnouncement =
    counterPosition && counterTotal
      ? `image ${counterPosition} of ${counterTotal}`
      : null;
  // A page with nothing to paint says so: the empty state is static content,
  // and the position alone would read as if a scan were there.
  const availability = imageFailed
    ? "image unavailable"
    : hasSource
      ? null
      : "no image";
  const announcement = [
    noteLabel,
    sideLabel,
    positionAnnouncement,
    availability,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      aria-describedby={`${escapeHintId} ${statusId}`}
      aria-labelledby={titleId}
      aria-modal="true"
      className="image-popover-overlay"
      onClick={clickScrim}
      ref={overlayRef}
      role="dialog"
      tabIndex={-1}
    >
      {/* The first Escape only steps back to Fit. The Close title says so once
          the button takes focus; the dialog carries the rule from the moment it
          opens, so a screen reader hears it before the zoom is touched. */}
      <span className="image-popover-announcer" id={escapeHintId}>
        Escape returns a zoomed image to Fit, then closes the preview.
      </span>
      <span className="image-popover-announcer" id={statusId} role="status">
        {announcement}
      </span>
      <div
        className={`image-popover-content${zoomed ? " image-popover-content--zoomed" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="image-popover-topbar">
          <div className="image-popover-meta">
            <div className="image-popover-identity">
              <h2 className="image-popover-note-label" id={titleId}>
                {noteLabel}
              </h2>
              {side ? (
                <div
                  aria-label="Image side"
                  className="image-popover-sides"
                  role="group"
                >
                  {POPOVER_SIDES.map((option) => {
                    const available = sideAvailable(option.kind);

                    return (
                      <button
                        aria-disabled={available ? undefined : true}
                        aria-pressed={side === option.kind}
                        className="image-popover-side-button"
                        key={option.kind}
                        onClick={() => selectSide(option.kind)}
                        title={
                          available
                            ? `Show the ${option.label.toLowerCase()} image`
                            : `No ${option.label.toLowerCase()} image for this note`
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="image-popover-actions">
            {hasSource ? (
              <div
                aria-label="Image zoom"
                className="image-popover-zoom"
                role="group"
              >
                <div className="image-popover-zoom-segments">
                  <button
                    aria-pressed={!zoomed}
                    className="image-popover-zoom-button"
                    onClick={resetZoom}
                    title="Fit the image to the plate"
                    type="button"
                  >
                    Fit
                  </button>
                  <button
                    aria-disabled={actualSize.inert ? true : undefined}
                    aria-pressed={actualSize.pressed}
                    className="image-popover-zoom-button"
                    onClick={() => {
                      if (actualSize.inert) {
                        return;
                      }

                      zoomTo(1);
                    }}
                    title={actualSize.title}
                    type="button"
                  >
                    1:1
                  </button>
                </div>
                <div className="image-popover-zoom-stepper">
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
                  {/* With no measurable scale the readout prints the table's
                      muted em dash: the pressed segment already says Fit, so
                      the readout must not echo the same word beside it. */}
                  <output
                    aria-label="Zoom level"
                    aria-live="polite"
                    className="image-popover-zoom-level"
                    title="Current zoom level"
                  >
                    {zoomPercent ? `${zoomPercent}%` : "—"}
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
              </div>
            ) : null}
            <NoteCounter
              countNoun="Image"
              jumpLabel="Image position"
              onJump={onJump}
              position={counterPosition}
              showArrows={false}
              total={counterTotal}
              valueRole="spinbutton"
              variant="dark"
            />
            <button
              aria-label="Close preview"
              className="button image-popover-close"
              data-shortcut={zoomed ? "Esc ×2" : "Esc"}
              onClick={onClose}
              title="Close preview (Esc twice when zoomed)"
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
            onClick={onPrevious}
            type="button"
          >
            <span aria-hidden="true">&larr;</span>
          </button>

          <div className={imageWrapClassName} ref={imageWrapRef}>
            {hasImage ? (
              <>
                {displayedSrc ? (
                  <img
                    alt={alt}
                    className="image-popover-full"
                    decoding="sync"
                    onDoubleClick={toggleZoom}
                    onDragStart={(e) => e.preventDefault()}
                    onError={() => failImage(displayedSrc || src)}
                    onLoad={measureImage}
                    onPointerCancel={onImagePointerUp}
                    onPointerDown={onImagePointerDown}
                    onPointerMove={onImagePointerMove}
                    onPointerUp={onImagePointerUp}
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
                    onError={() => failImage(thumb)}
                    src={thumb}
                  />
                ) : null}
              </>
            ) : (
              <div className="image-popover-empty-state">
                {imageFailed ? (
                  <>
                    <p className="eyebrow">Image unavailable</p>
                    <p>This image file could not be loaded.</p>
                    {fileName ? (
                      <p className="image-popover-empty-file">{fileName}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="eyebrow">No preview</p>
                    <p>{placeholderText}</p>
                  </>
                )}
                {onEdit ? (
                  <button
                    className="icon-link"
                    onClick={onEdit}
                    type="button"
                  >
                    Edit note
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {hasImage && !fullLoaded ? (
            <span aria-hidden="true" className="image-loading-spinner" />
          ) : null}

          <button
            aria-label="Show next image"
            className="arrow-button image-popover-arrow"
            disabled={!canGoNext}
            onClick={onNext}
            type="button"
          >
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// One foot turn. The two mirror each other, so the direction alone decides the
// arrow side, the copy and the handler; the edge case stays visible and inert.
function SlideshowTurn({ direction, edgeCopy, note, onTurn }) {
  const next = direction === "next";
  const directionLabel = next ? "Next" : "Previous";
  const name = note ? getNeighbourLabel(note) : edgeCopy;

  return (
    <button
      aria-label={`${directionLabel} note: ${name}`}
      className={`button slideshow-turn slideshow-turn--${direction}`}
      disabled={!note}
      onClick={onTurn}
      title={`${directionLabel} note (${next ? "→" : "←"})`}
      type="button"
    >
      {next ? null : (
        <span aria-hidden="true" className="slideshow-turn-arrow">
          &larr;
        </span>
      )}
      <span className="slideshow-turn-text">
        <span className="slideshow-turn-direction">{directionLabel}</span>
        <span className="slideshow-turn-name">{name}</span>
      </span>
      {next ? (
        <span aria-hidden="true" className="slideshow-turn-arrow">
          &rarr;
        </span>
      ) : null}
    </button>
  );
}

function Slideshow({
  collectionName = "Notes",
  currentIndex,
  filterConditions = [],
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
  // Plates whose image file failed to load, keyed by the versioned source, so
  // a replaced file gets its own attempt instead of inheriting the failure.
  const [failedPlateSources, setFailedPlateSources] = useState(
    () => new Set(),
  );
  const markPlateFailed = useCallback((source) => {
    setFailedPlateSources((current) => {
      if (current.has(source)) {
        return current;
      }

      const next = new Set(current);
      next.add(source);
      return next;
    });
  }, []);
  const shellToastRef = useToastHost();
  // The thumbnail the popover was opened from, so closing it returns the
  // keyboard to that control rather than the room's section.
  const previewTriggerRef = useRef(null);
  const wasPreviewRef = useRef(Boolean(previewKind));
  // The room walk and the popover paging keep separate budgets: opening the
  // preview right after a note move must not defer the first page.
  const {
    cancelPendingMove: cancelRoomMove,
    requestMove: requestRoomMove,
    walking,
  } = usePacedMove();
  const {
    cancelPendingMove: cancelPreviewMove,
    requestMove: requestPreviewMove,
  } = usePacedMove();

  // The open note's two faces, used by the slide plates, the popover, and the
  // keyboard hand-off. One derivation per note change.
  const previewItems = useMemo(
    () => (note ? getPreviewItems(note, { includeMissingSides: true }) : []),
    [note],
  );

  // The flattened image sequence the popover pages through: front/back for
  // every note, in slide order. One memo drives the counters and the
  // neighbour prefetches instead of recomputing the walk per render. It is
  // only built while a preview is open: a walk over the room must not rebuild
  // an entry for every note each time a note detail arrives.
  const previewSequence = useMemo(() => {
    if (!previewKind) {
      return [];
    }

    const sequence = [];

    notes.forEach((entry) => {
      getPreviewItems(entry, { includeMissingSides: true }).forEach((item) => {
        sequence.push({ ...item, note: entry });
      });
    });

    return sequence;
  }, [notes, previewKind]);
  const previewIndex =
    previewKind && note
      ? previewSequence.findIndex(
          (item) => item.note.id === note.id && item.kind === previewKind,
        )
      : -1;
  const previewItem = previewIndex >= 0 ? previewSequence[previewIndex] : null;

  // The next/previous slides are what a held arrow key reaches for. Preload
  // their 500px thumbnails at idle: cheap enough that a walk is instant, and
  // the visible slide never waits behind them. The walk stops at the ends, so
  // an edge warms only the neighbour it can actually reach.
  const neighbouringThumbs = useMemo(() => {
    const neighbours = [
      notes[currentIndex - 1],
      notes[currentIndex + 1],
    ].filter(Boolean);
    const urls = [];

    neighbours.forEach((entry) => {
      getPreviewItems(entry).forEach((item) => {
        if (item.thumb) {
          urls.push(item.thumb);
        }
      });
    });

    return urls;
  }, [currentIndex, notes]);
  useImagePreload(neighbouringThumbs, { cache: "thumbnail" });

  // The slide plates warm their own full scans after the thumbnails paint, so
  // there is no separate full-plate prefetch here: it would decode the same
  // two images a second time and compete with the plate the reader is looking
  // at. Hovering or focusing a plate still warms the face Enter will open.

  // While the popover is open, warm and decode the previous/next plate in its
  // sequence. The delay outlasts the paging interval, so a held arrow key
  // never queues a download for a page it is about to skip; the current page
  // still probes at high priority. The idle decode is what makes a normal
  // arrow press swap a frame that is ready.
  const neighbouringPreviewImages = useMemo(
    () => neighbouringImageSources(previewSequence, previewIndex),
    [previewIndex, previewSequence],
  );
  useImagePreload(neighbouringPreviewImages, {
    decode: true,
    delay: 250,
    priority: "low",
  });

  function preloadPreviewItem(item) {
    if (item?.src) {
      preloadImage(item.src, { priority: "high" });
    }
  }

  // The walk stops at the ends; it never wraps to the other end of the set.
  // The bound check runs now for the two turns and the arrow keys, while the
  // index clamp inside the updater keeps a move queued by the pacing window
  // from overshooting the last note. Typed jumps still go through
  // changeSlideshowIndex and keep their modulo clamp.
  function moveSlideshow(offset) {
    const target = currentIndex + offset;

    if (target < 0 || target >= notes.length) {
      return;
    }

    requestRoomMove(() =>
      onChangeIndex((current) =>
        Math.min(Math.max(current + offset, 0), notes.length - 1),
      ),
    );
  }

  // Closing the popover and stepping out of it to the editor take the same
  // route: drop any queued page, then strip the preview from the address.
  function leavePreview() {
    cancelPreviewMove();
    onClosePreview?.(note.id);
  }

  async function handleCopyNoteDetails() {
    const clipboardValue = formatNoteAsTsvRow(note);

    try {
      await copyTextToClipboard(clipboardValue);
      // Success confirms with the toast alone: an earlier copy failure's
      // danger line stays until its own retry clears it.
      shellToastRef?.current?.show("Note fields copied");
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
        cancelRoomMove();
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

        cancelRoomMove();
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
          (item) =>
            (item.kind === "front" || item.kind === "back") &&
            !failedPlateSources.has(item.thumb),
        );

        if (openableItem) {
          cancelRoomMove();
          event.preventDefault();
          onOpenPreview?.(note.id, openableItem.kind);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cancelRoomMove,
    currentIndex,
    failedPlateSources,
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
  // The walk does not wrap, so an edge has no neighbour to name: the turn is
  // inert and says the set ends there.
  const previousNote = currentIndex > 0 ? notes[currentIndex - 1] : null;
  const nextNote =
    currentIndex < notes.length - 1 ? notes[currentIndex + 1] : null;
  const progressPercent = ((currentIndex + 1) / notes.length) * 100;
  const walkingCopy = `Collection · walking ${notes.length} ${
    notes.length === 1 ? "note" : "notes"
  }`;

  // While an editor overlay is open the slideshow is a backdrop: it keeps
  // rendering, but `inert` takes its controls out of the tab order and stops
  // clicks, so a stray Tab cannot reach behind the modal and act (closing the
  // slideshow or typing a counter jump) while the editor holds unsaved work.
  // The section is the room's dialog; the panel steps aside (but the nested
  // Image popover does not) while a plate is enlarged.
  return (
    <section
      aria-label={note ? getNoteTitle(note) : "Note slideshow"}
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
          availableSides={previewItems
            .filter((item) => item.src)
            .map((item) => item.kind)}
          canGoNext={totalPreviewCount > 1}
          canGoPrevious={totalPreviewCount > 1}
          counterPosition={previewSequenceIndex}
          counterTotal={totalPreviewCount}
          noteKey={note.id}
          noteLabel={getNoteDisplayLabel(note)}
          onClose={leavePreview}
          onEdit={
            readOnly
              ? undefined
              : () => {
                  // The editor is the fix for a missing scan: leave the
                  // preview first so the editor is not a layer behind it.
                  leavePreview();
                  onEdit?.(note.id);
                }
          }
          onJump={(position) => {
            cancelPreviewMove();
            onJumpPreview?.(position);
          }}
          onNext={() => requestPreviewMove(() => onMovePreview?.(1))}
          onPrevious={() => requestPreviewMove(() => onMovePreview?.(-1))}
          onPreviewEnd={() => {
            cancelPreviewMove();
            return onPreviewEnd?.();
          }}
          onPreviewStart={() => {
            cancelPreviewMove();
            return onPreviewStart?.();
          }}
          onSelectSide={(kind) =>
            // The slideshow sequence keeps both slots for every note, so the
            // other face is always one step away.
            requestPreviewMove(() => onMovePreview?.(kind === "back" ? 1 : -1))
          }
          placeholderText={`No scraped ${previewItem.label.toLowerCase()} image exists for this note yet.`}
          side={previewKind}
          src={previewItem.src}
          thumb={previewItem.thumb}
        />
      )}

      <div className="slideshow-panel" inert={Boolean(previewItem)}>
        <header className="slideshow-topbar">
          <div className="slideshow-heading">
            <p className="eyebrow">{walkingCopy}</p>
            <div className="slideshow-set">
              <p className="slideshow-collection-name">{collectionName}</p>
              {filterConditions.map((condition) => {
                const fieldLabel = filterFieldLabel(condition.field);
                const value = `${condition.negated ? "not " : ""}${condition.value}`;

                return (
                  <span
                    className={`table-filter-chip slideshow-filter-chip${
                      condition.negated ? " table-filter-chip--negated" : ""
                    }`}
                    key={condition.id}
                    title={`Filter ${fieldLabel} ${value}`}
                  >
                    {fieldLabel} {value}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="slideshow-topbar-actions">
            <div className="slideshow-progress">
              <NoteCounter
                jumpLabel="Note position"
                onJump={(position) => {
                  cancelRoomMove();
                  onJump?.(position);
                }}
                position={currentIndex + 1}
                separator=" of "
                showArrows={false}
                total={notes.length}
                variant="dark"
              />
              <span aria-hidden="true" className="slideshow-progress-rail">
                <span
                  className="slideshow-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </span>
            </div>
            <button
              aria-label="Copy fields"
              className="button"
              onClick={handleCopyNoteDetails}
              title="Copy fields"
              type="button"
            >
              Copy fields
            </button>
            {readOnly ? null : (
              <>
                <button
                  aria-label="Add before this note"
                  className="button"
                  onClick={() => onAdd?.(note.id)}
                  title="Add note before this one (a)"
                  type="button"
                >
                  Add before
                </button>
                <button
                  aria-label="Edit note"
                  className="button button-primary"
                  onClick={() => onEdit?.(note.id)}
                  title="Edit note (e)"
                  type="button"
                >
                  Edit
                </button>
              </>
            )}
            <span aria-hidden="true" className="slideshow-topbar-divider" />
            <button
              aria-label="Close slideshow"
              className="button slideshow-close"
              data-shortcut="Esc"
              onClick={onClose}
              title="Close slideshow"
              type="button"
            >
              Close
            </button>
          </div>
        </header>

        <div className="slideshow-layout">
          <div className="slide-card">
            <div className="slide-images">
              {hasSlideImages ? (
                previewItems.map((item) => {
                  const plateFailed = failedPlateSources.has(item.thumb);
                  const plateFileName = plateFailed
                    ? fileNameFromPath(item.thumb) || "Image file"
                    : null;

                  return (
                    <button
                      key={item.kind}
                      aria-label={
                        plateFailed
                          ? `${item.label} image unavailable: ${plateFileName}`
                          : `Enlarge ${item.label.toLowerCase()} image`
                      }
                      className="slide-thumb-btn"
                      disabled={plateFailed}
                      onClick={(event) => {
                        previewTriggerRef.current = event.currentTarget;
                        cancelRoomMove();
                        onOpenPreview?.(note.id, item.kind);
                      }}
                      onFocus={() => preloadPreviewItem(item)}
                      onMouseEnter={() => preloadPreviewItem(item)}
                      title={
                        plateFailed
                          ? "Image unavailable"
                          : "Click to enlarge"
                      }
                      type="button"
                    >
                      {item.thumb ? (
                        <SlidePlate
                          alt={item.alt}
                          deferFull={walking}
                          failed={plateFailed}
                          fileName={plateFileName ?? undefined}
                          onError={() => markPlateFailed(item.thumb)}
                          paused={Boolean(previewItem)}
                          src={item.slide}
                          thumb={item.thumb}
                        />
                      ) : (
                        <div className="slide-thumb-placeholder">
                          No scraped image yet
                        </div>
                      )}
                      <span className="slide-thumb-label">{item.label}</span>
                    </button>
                  );
                })
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
                {note.grading_company ? (
                  <p className="eyebrow">{note.grading_company}</p>
                ) : null}
                <h1>{getNoteTitle(note)}</h1>
                <p className="slide-issue">
                  <NoteValue value={note.issue_date} />
                </p>
              </div>
              <div className="detail-grid">
                <p>
                  <strong>Catalog:</strong>{" "}
                  <NoteValue value={note.catalog_number} />
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
                    <span className="muted">-</span>
                  )}
                </p>
                <p>
                  <strong>Serial:</strong> <NoteValue value={note.serial} />
                </p>
                <p>
                  <strong>Watermark:</strong>{" "}
                  <NoteValue value={note.watermark} />
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
              {String(note.notes ?? "").trim() ? (
                <p className="slide-notes">{note.notes}</p>
              ) : null}
              <div className="tag-list">
                {note.tags.map((tag) => (
                  <span className="tag" key={tag.id || tag.name}>
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="slideshow-foot">
          <SlideshowTurn
            direction="previous"
            edgeCopy="Start of set"
            note={previousNote}
            onTurn={() => moveSlideshow(-1)}
          />
          <SlideshowTurn
            direction="next"
            edgeCopy="End of set"
            note={nextNote}
            onTurn={() => moveSlideshow(1)}
          />
        </footer>
      </div>
    </section>
  );
}

export { ImagePopover, Slideshow };
