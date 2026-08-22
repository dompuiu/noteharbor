import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { copyTextToClipboard, formatNoteAsTsvRow } from "../lib/noteClipboard.js";

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

  const frontItem = {
    alt: `${note.denomination} front`,
    kind: "front",
    label: "Front",
    src: frontFull || frontThumb,
    thumb: frontThumb || frontFull,
  };
  const backItem = {
    alt: `${note.denomination} back`,
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

const POPOVER_ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3, 4];

function ImagePopover({
  alt,
  canGoNext,
  canGoPrevious,
  counterLabel,
  noteLabel,
  onClose,
  onNext,
  onPrevious,
  placeholderText,
  src,
}) {
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoomScale, setZoomScale] = useState(0);

  const zoomed = zoomScale > 0;
  const scaledSize = {
    width: naturalSize.width * zoomScale,
    height: naturalSize.height * zoomScale,
  };
  const overflowX = Math.max(0, scaledSize.width - viewportSize.width);
  const overflowY = Math.max(0, scaledSize.height - viewportSize.height);
  const pannable = zoomed && (overflowX > 0 || overflowY > 0);

  function clampOffset(nextOffset, scale = zoomScale) {
    const scaledWidth = naturalSize.width * scale;
    const scaledHeight = naturalSize.height * scale;
    const maxX = Math.max(0, scaledWidth - viewportSize.width) / 2;
    const maxY = Math.max(0, scaledHeight - viewportSize.height) / 2;

    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    };
  }

  function measureImage() {
    const image = imageRef.current;

    if (!image) {
      return;
    }

    const imageRect = image.getBoundingClientRect();
    setNaturalSize({
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    });

    if (!zoomScale && imageRect.width && imageRect.height) {
      setViewportSize({ width: imageRect.width, height: imageRect.height });
    }
  }

  function resetZoom() {
    setZoomScale(0);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
  }

  function getNextZoomScale(direction) {
    if (direction > 0) {
      return (
        POPOVER_ZOOM_LEVELS.find((scale) => scale > zoomScale) ??
        POPOVER_ZOOM_LEVELS[POPOVER_ZOOM_LEVELS.length - 1]
      );
    }

    const lowerScale = [...POPOVER_ZOOM_LEVELS]
      .reverse()
      .find((scale) => scale < zoomScale);

    return lowerScale ?? 0;
  }

  function changeZoom(direction, anchor = null) {
    if (!src) {
      return;
    }

    measureImage();
    const nextScale = getNextZoomScale(direction);

    if (!nextScale) {
      resetZoom();
      return;
    }

    if (!zoomScale || !anchor) {
      setZoomScale(nextScale);
      setOffset((currentOffset) => clampOffset(currentOffset, nextScale));
      return;
    }

    const scaleRatio = nextScale / zoomScale;
    const nextOffset = {
      x: anchor.x - viewportSize.width / 2 + (offset.x - anchor.x + viewportSize.width / 2) * scaleRatio,
      y: anchor.y - viewportSize.height / 2 + (offset.y - anchor.y + viewportSize.height / 2) * scaleRatio,
    };

    setZoomScale(nextScale);
    setOffset(clampOffset(nextOffset, nextScale));
  }

  function zoomIn() {
    changeZoom(1);
  }

  function zoomOut() {
    changeZoom(-1);
  }

  function toggleZoom() {
    if (zoomed) {
      resetZoom();
      return;
    }

    changeZoom(1);
  }

  function moveToNextImage() {
    resetZoom();
    onNext();
  }

  function moveToPreviousImage() {
    resetZoom();
    onPrevious();
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
    if (!src) {
      return;
    }

    e.preventDefault();
    const wrapRect = e.currentTarget.parentElement.getBoundingClientRect();
    const anchor = {
      x: e.clientX - wrapRect.left,
      y: e.clientY - wrapRect.top,
    };
    changeZoom(e.deltaY < 0 ? 1 : -1, anchor);
  }

  useEffect(() => {
    resetZoom();
  }, [src]);

  useLayoutEffect(() => {
    if (!src || zoomScale) {
      return undefined;
    }

    measureImage();

    const image = imageRef.current;

    if (!image || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(measureImage);
    resizeObserver.observe(image);

    return () => resizeObserver.disconnect();
  }, [src, zoomScale]);

  useEffect(() => {
    if (!zoomScale) {
      return;
    }

    setOffset((currentOffset) => clampOffset(currentOffset));
  }, [overflowX, overflowY, zoomScale]);

  useEffect(() => {
    function onKeyDown(e) {
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

      if (pannable && e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        panBy(-overflowX * 0.05, 0);
        return;
      }

      if (pannable && e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        panBy(overflowX * 0.05, 0);
        return;
      }

      if (pannable && e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        panBy(0, -overflowY * 0.05);
        return;
      }

      if (pannable && e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        panBy(0, overflowY * 0.05);
        return;
      }

      if (e.key === "ArrowRight") {
        moveToNextImage();
      }

      if (e.key === "ArrowLeft") {
        moveToPreviousImage();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrevious, overflowX, overflowY, pannable, zoomScale]);

  const imageWrapClassName = [
    "image-popover-image-wrap",
    zoomed ? "image-popover-image-wrap--zoomed" : null,
    pannable ? "image-popover-image-wrap--pannable" : null,
    isDragging ? "image-popover-image-wrap--dragging" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const imageWrapStyle =
    zoomed && viewportSize.width && viewportSize.height
      ? {
          height: `${viewportSize.height}px`,
          width: `${viewportSize.width}px`,
        }
      : undefined;
  const imageStyle =
    zoomed && scaledSize.width && scaledSize.height
      ? {
          height: `${scaledSize.height}px`,
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          width: `${scaledSize.width}px`,
        }
      : undefined;

  return (
    <div className="image-popover-overlay" onClick={onClose}>
      <div
        className="image-popover-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="image-popover-topbar">
          <div className="image-popover-meta">
            <p className="eyebrow">Preview</p>
            <p className="image-popover-note-label">{noteLabel}</p>
          </div>
          <div className="image-popover-actions">
            <div className="counter-pill">{counterLabel}</div>
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
            data-shortcut={canGoPrevious ? "←" : undefined}
            disabled={!canGoPrevious}
            onClick={moveToPreviousImage}
            type="button"
          >
            <span aria-hidden="true">&larr;</span>
          </button>

          <div className={imageWrapClassName} style={imageWrapStyle}>
            {src ? (
              <img
                alt={alt}
                onDoubleClick={toggleZoom}
                onDragStart={(e) => e.preventDefault()}
                onLoad={measureImage}
                onPointerCancel={onImagePointerUp}
                onPointerDown={onImagePointerDown}
                onPointerMove={onImagePointerMove}
                onPointerUp={onImagePointerUp}
                onWheel={onImageWheel}
                ref={imageRef}
                src={src}
                style={imageStyle}
              />
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
            data-shortcut={canGoNext ? "→" : undefined}
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
  onChangeIndex,
  onClose,
  onCopy,
  onEdit,
  onClosePreview,
  onMovePreview,
  onOpenPreview,
  previewKind = null,
}) {
  const note = notes[currentIndex];

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
    if (keyboardDisabled) {
      return undefined;
    }

    function onKeyDown(event) {
      if (previewKind) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowRight") {
        moveSlideshow(1);
        return;
      }

      if (event.key === "ArrowLeft") {
        moveSlideshow(-1);
        return;
      }

      if ((event.key === "Enter" || event.key === "ArrowDown") && note) {
        event.preventDefault();
        const openableItem = getPreviewItems(note, {
          includeMissingSides: true,
        }).find((item) => item.kind === "front" || item.kind === "back");

        if (openableItem) {
          onOpenPreview?.(note.id, openableItem.kind);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardDisabled, note, notes.length, onClose, onOpenPreview, previewKind]);

  if (!notes.length) {
    return null;
  }

  const previewItems = getPreviewItems(note, { includeMissingSides: true });
  const scrapedDetailEntries = getScrapedDetailEntries(note);
  const previewNote = previewKind ? note : null;
  const previewNoteItems = previewNote
    ? getPreviewItems(previewNote, { includeMissingSides: true })
    : [];
  const previewItem = previewNoteItems.find(
    (item) => item.kind === previewKind,
  );
  const totalPreviewCount = notes.reduce(
    (count, entry) =>
      count + getPreviewItems(entry, { includeMissingSides: true }).length,
    0,
  );
  const previewSequenceIndex = previewKind
    ? notes
        .slice(0, currentIndex)
        .reduce(
          (count, entry) =>
            count +
            getPreviewItems(entry, { includeMissingSides: true }).length,
          0,
        ) +
      previewNoteItems.findIndex(
        (item) => item.kind === previewKind,
      ) +
      1
    : 0;
  const scrapePanelTitle = getScrapePanelTitle(note);

  return (
    <section className="slideshow-screen slideshow-screen--overlay">
      {previewItem && previewNote && (
        <ImagePopover
          alt={previewItem.alt}
          canGoNext={totalPreviewCount > 1}
          canGoPrevious={totalPreviewCount > 1}
          counterLabel={`${previewSequenceIndex} / ${totalPreviewCount}`}
          noteLabel={`${getNoteDisplayLabel(previewNote)} - ${previewItem.label}`}
          onClose={() => onClosePreview?.(note.id)}
          onNext={() => onMovePreview?.(1)}
          onPrevious={() => onMovePreview?.(-1)}
          placeholderText={`No scraped ${previewItem.label.toLowerCase()} image exists for this note yet.`}
          src={previewItem.src}
        />
      )}

      <div className="slideshow-topbar">
        <div className="slideshow-topbar-actions">
          <div className="counter-pill">
            {currentIndex + 1} / {notes.length}
          </div>
          <button
            aria-label="Copy note details"
            className="icon-link icon-link--on-dark"
            onClick={handleCopyNoteDetails}
            title="Copy note details"
            type="button"
          >
            <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
              <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="9" y="9" />
              <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="5" y="5" />
            </svg>
          </button>
          <button
            aria-label="Edit note"
            className="icon-link icon-link--on-dark"
            onClick={() => onEdit?.(note.id)}
            title="Edit note"
            type="button"
          >
            Edit note
          </button>
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
          data-shortcut="←"
          onClick={() => moveSlideshow(-1)}
          title="Previous note (←)"
          type="button"
        >
          <span aria-hidden="true">&larr;</span>
        </button>

        <div className="slide-card">
          <div className="slide-images">
            {previewItems.map((item, itemIndex) => (
              <button
                key={item.kind}
                aria-label={`Enlarge ${item.label.toLowerCase()} image`}
                className="slide-thumb-btn"
                data-shortcut={itemIndex === 0 ? "Enter" : undefined}
                onClick={() => onOpenPreview?.(note.id, item.kind)}
                title="Click to enlarge"
                type="button"
              >
                {item.thumb ? (
                  <img alt={item.alt} src={item.thumb} />
                ) : (
                  <div className="slide-thumb-placeholder">No scraped image yet</div>
                )}
                <span className="slide-thumb-label">{item.label}</span>
              </button>
            ))}
          </div>

          <div className="slide-meta">
            <div>
              <p className="eyebrow">
                {note.grading_company || "Collection note"}
              </p>
              <h1>{note.denomination}</h1>
              <p>{note.issue_date}</p>
            </div>
            <div className="detail-grid">
              <p>
                <strong>Catalog:</strong> {note.catalog_number || "-"}
              </p>
              <p>
                <strong>Grade:</strong> {note.grade || "-"}
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
                <div className="scraped-details-grid">
                  {scrapedDetailEntries.map(([key, value]) => (
                    <p key={key}>
                      <strong>{formatScrapedLabel(key)}:</strong>{" "}
                      {key === "source_url" && isHttpUrl(value) ? (
                        <a
                          href={String(value)}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {String(value)}
                        </a>
                      ) : (
                        String(value)
                      )}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            <p>{note.notes || "No extra notes."}</p>
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
          data-shortcut="→"
          onClick={() => moveSlideshow(1)}
          title="Next note (→)"
          type="button"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </section>
  );
}

export { Slideshow };
