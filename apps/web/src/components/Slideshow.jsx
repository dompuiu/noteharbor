import { useEffect, useState } from "react";
import { isReadOnlyMode } from "../lib/appMode.js";

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

function pickImage(note, type, variant = "full") {
  return (
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null
  );
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
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowRight") {
        onNext();
      }

      if (e.key === "ArrowLeft") {
        onPrevious();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrevious]);

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
              className="image-popover-close"
              onClick={onClose}
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

          <div className="image-popover-image-wrap">
            {src ? (
              <img alt={alt} src={src} />
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

function Slideshow({
  currentIndex,
  keyboardDisabled = false,
  notes,
  onChangeIndex,
  onClose,
  onEdit,
}) {
  const [previewState, setPreviewState] = useState(null);

  function openPreview(noteIndex, imageKind) {
    setPreviewState({ imageKind, noteIndex });
  }

  function closePreview() {
    setPreviewState(null);
  }

  function moveSlideshow(offset) {
    onChangeIndex(
      (current) => (current + offset + notes.length) % notes.length,
    );
  }

  function movePreview(offset) {
    setPreviewState((currentPreview) => {
      if (!currentPreview || !notes.length) {
        return currentPreview;
      }

      const direction = offset >= 0 ? 1 : -1;
      let nextNoteIndex = currentPreview.noteIndex;
      let nextItems = getPreviewItems(notes[nextNoteIndex], {
        includeMissingSides: true,
      });
      let nextItemIndex = nextItems.findIndex(
        (item) => item.kind === currentPreview.imageKind,
      );

      if (nextItemIndex < 0) {
        nextItemIndex = direction > 0 ? -1 : nextItems.length;
      }

      let remainingSteps = Math.abs(offset);

      while (remainingSteps > 0) {
        const candidateIndex = nextItemIndex + direction;

        if (candidateIndex >= 0 && candidateIndex < nextItems.length) {
          nextItemIndex = candidateIndex;
          remainingSteps -= 1;
          continue;
        }

        nextNoteIndex =
          (nextNoteIndex + direction + notes.length) % notes.length;
        nextItems = getPreviewItems(notes[nextNoteIndex], {
          includeMissingSides: true,
        });
        nextItemIndex = direction > 0 ? 0 : nextItems.length - 1;
        remainingSteps -= 1;
      }

      onChangeIndex(nextNoteIndex);

      return {
        imageKind: nextItems[nextItemIndex].kind,
        noteIndex: nextNoteIndex,
      };
    });
  }

  useEffect(() => {
    if (keyboardDisabled) {
      return undefined;
    }

    function onKeyDown(event) {
      if (previewState) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowRight") {
        moveSlideshow(1);
      }

      if (event.key === "ArrowLeft") {
        moveSlideshow(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardDisabled, notes.length, onClose, previewState]);

  useEffect(() => {
    setPreviewState((currentPreview) => {
      if (!currentPreview || !notes.length) {
        return currentPreview;
      }

      const boundedNoteIndex =
        ((currentPreview.noteIndex % notes.length) + notes.length) %
        notes.length;
      const previewItems = getPreviewItems(notes[boundedNoteIndex], {
        includeMissingSides: true,
      });

      if (previewItems.some((item) => item.kind === currentPreview.imageKind)) {
        if (boundedNoteIndex === currentPreview.noteIndex) {
          return currentPreview;
        }

        return { ...currentPreview, noteIndex: boundedNoteIndex };
      }

      return {
        imageKind: previewItems[0].kind,
        noteIndex: boundedNoteIndex,
      };
    });
  }, [notes]);

  if (!notes.length) {
    return null;
  }

  const note = notes[currentIndex];
  const previewItems = getPreviewItems(note, { includeMissingSides: true });
  const scrapedDetailEntries = getScrapedDetailEntries(note);
  const previewNote =
    previewState && notes[previewState.noteIndex]
      ? notes[previewState.noteIndex]
      : null;
  const previewNoteItems = previewNote
    ? getPreviewItems(previewNote, { includeMissingSides: true })
    : [];
  const previewItem = previewNoteItems.find(
    (item) => item.kind === previewState?.imageKind,
  );
  const totalPreviewCount = notes.reduce(
    (count, entry) =>
      count + getPreviewItems(entry, { includeMissingSides: true }).length,
    0,
  );
  const previewSequenceIndex = previewState
    ? notes
        .slice(0, previewState.noteIndex)
        .reduce(
          (count, entry) =>
            count +
            getPreviewItems(entry, { includeMissingSides: true }).length,
          0,
        ) +
      previewNoteItems.findIndex(
        (item) => item.kind === previewState.imageKind,
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
          noteLabel={`${previewNote.denomination} - ${previewItem.label}`}
          onClose={closePreview}
          onNext={() => movePreview(1)}
          onPrevious={() => movePreview(-1)}
          placeholderText={`No scraped ${previewItem.label.toLowerCase()} image exists for this note yet.`}
          src={previewItem.src}
        />
      )}

      <div className="slideshow-topbar">
        <div className="slideshow-topbar-actions">
          <div className="counter-pill">
            {currentIndex + 1} / {notes.length}
          </div>
          {!isReadOnlyMode ? (
            <button
              className="slideshow-exit-button"
              onClick={() => onEdit?.(note.id)}
              type="button"
            >
              Edit note
            </button>
          ) : null}
          <button
            className="slideshow-exit-button"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>

      <div className="slideshow-layout">
        <button
          className="arrow-button"
          onClick={() => moveSlideshow(-1)}
          type="button"
        >
          <span aria-hidden="true">&larr;</span>
        </button>

        <div className="slide-card">
          <div className="slide-images">
            {previewItems.map((item) => (
              <button
                key={item.kind}
                className="slide-thumb-btn"
                onClick={() => openPreview(currentIndex, item.kind)}
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
          className="arrow-button"
          onClick={() => moveSlideshow(1)}
          type="button"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </section>
  );
}

export { Slideshow };
