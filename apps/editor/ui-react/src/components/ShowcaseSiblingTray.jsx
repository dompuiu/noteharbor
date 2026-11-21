import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getNoteSiblings } from "../lib/api.js";
import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import {
  findShowcasePreviewIndex,
  getSiblingPreviewItems,
} from "../lib/showcasePreview.js";
import { showcaseNoteTitleParts } from "../lib/showcaseNoteLabels.js";
import { ImagePopover } from "./Slideshow.jsx";

// The Compare tray: a bottom sheet with the current Note pinned on the left
// and its siblings in a filmstrip. It fetches its own fresh list when it opens
// (the tree's count can be stale), marks siblings already presented by another
// Note card in this Showcase, and replaces the pinned Note in place through the
// Showcase screen. A pinned Note and a sibling share one card anatomy; only the
// pinned state and the select action differ. Sibling photos open the shared
// Image popover over the sibling set; the current Note's photo keeps the
// Showcase preview.
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

function noteLabel(note) {
  return showcaseNoteTitleParts(note).join(" · ") || "Untitled note";
}

function text(value) {
  return String(value ?? "").trim();
}

function gradeLabel(note) {
  const grade = text(note?.grade);
  const company = text(note?.grading_company);

  return [grade, company].filter(Boolean).join(" ") || "No grade";
}

function tagNames(note) {
  return (Array.isArray(note?.tags) ? note.tags : [])
    .map((tag) => (typeof tag === "string" ? tag : tag?.name))
    .filter(Boolean);
}

function collectionName(collections, id) {
  return (
    collections?.find((collection) => collection.id === id)?.name ?? "Collection"
  );
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function traySubtitle({ alreadyHere, available, error, loading, siblings }) {
  if (loading) {
    return "Loading siblings…";
  }

  if (error) {
    return "Could not load the siblings.";
  }

  return [
    plural(siblings.length, "sibling"),
    `${available.length} available`,
    alreadyHere ? `${alreadyHere} already in this showcase` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// One sibling card, and the pinned current Note in the same anatomy. The
// current card has no select action; it names itself instead.
function TrayNoteCard({
  collections,
  current = false,
  inShowcase = false,
  note,
  onOpenPhoto,
  onSelect,
  selected = false,
}) {
  const image = firstAvailableNoteImage(note);
  const label = noteLabel(note);
  const tags = tagNames(note);

  const body = (
    <>
      <span className="showcase-tray-collection">
        {collectionName(collections, note.collection_id)}
      </span>
      <span className="showcase-tray-serial">
        {text(note.serial) || "No serial"}
      </span>
      <span className="showcase-tray-grade">{gradeLabel(note)}</span>
      {tags.length ? (
        <span className="showcase-tray-tags">
          {tags.map((tag) => (
            <span className="showcase-tray-tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      ) : null}
      <span className="showcase-tray-select-foot">
        <span>{note.owned ? "Owned" : "Seen"}</span>
        <span className="showcase-tray-check">
          {current
            ? "Current note"
            : inShowcase
              ? "In this showcase"
              : selected
                ? "Selected"
                : "Select"}
        </span>
      </span>
    </>
  );

  return (
    <article
      className={`showcase-tray-card${current ? " showcase-tray-card--current" : ""}${selected ? " is-selected" : ""}${inShowcase ? " is-in-showcase" : ""}`}
    >
      <button
        aria-label={
          current ? "View images of the current note" : `View images of ${label}`
        }
        className="showcase-tray-photo"
        disabled={!image}
        onClick={(event) => onOpenPhoto?.(event.currentTarget, image)}
        type="button"
      >
        {image ? (
          <img alt="" draggable="false" src={image.path} />
        ) : (
          <span className="showcase-tray-no-image">No image</span>
        )}
      </button>
      {current ? (
        <div className="showcase-tray-select showcase-tray-select--current">
          {body}
        </div>
      ) : (
        <button
          aria-label={
            inShowcase
              ? `${label} is in this showcase`
              : selected
                ? `${label} selected`
                : `Select ${label}`
          }
          aria-pressed={selected}
          className="showcase-tray-select"
          disabled={inShowcase}
          onClick={() => onSelect?.(note)}
          type="button"
        >
          {body}
        </button>
      )}
    </article>
  );
}

function ShowcaseSiblingTray({
  collections,
  inShowcaseNoteIds,
  node,
  onBrowseAll,
  onClose,
  onOpenCurrentImage,
  onReplace,
  previewOpen = false,
}) {
  const titleId = useId();
  const panelRef = useRef(null);
  const previewReturnRef = useRef(null);
  const [siblings, setSiblings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const note = node?.note ?? null;
  const noteId = note?.id ?? null;
  const previewItems = useMemo(
    () => getSiblingPreviewItems(siblings),
    [siblings],
  );
  const previewItem =
    previewIndex == null ? null : (previewItems[previewIndex] ?? null);

  useEffect(() => {
    let active = true;

    if (noteId == null) {
      setSiblings([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");
    setSelectedId(null);

    getNoteSiblings(noteId)
      .then((list) => {
        if (active) {
          setSiblings(list);
          setLoading(false);
        }
      })
      .catch((loadError) => {
        if (active) {
          setSiblings([]);
          setError(loadError.message || "Could not load the siblings.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, noteId]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (previewIndex != null || previewOpen) {
        // The Image popover owns Escape and its own focus while it is open.
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusables = Array.from(
        panelRef.current.querySelectorAll(FOCUSABLE),
      );

      if (!focusables.length) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus starts on the panel itself, so Shift+Tab there must wrap to the
      // last control inside the tray, not escape behind the scrim.
      const atPanel = document.activeElement === panelRef.current;

      if (event.shiftKey && (atPanel || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, previewIndex, previewOpen]);

  if (!note) {
    return null;
  }

  const inShowcase = new Set(inShowcaseNoteIds ?? []);
  const available = siblings.filter((sibling) => !inShowcase.has(sibling.id));
  const alreadyHere = siblings.length - available.length;
  const selected = siblings.find((sibling) => sibling.id === selectedId) ?? null;
  const subtitle = traySubtitle({
    alreadyHere,
    available,
    error,
    loading,
    siblings,
  });

  function openPreview(sibling, kind, trigger) {
    const index = findShowcasePreviewIndex(previewItems, sibling.id, kind);

    if (index < 0) {
      return;
    }

    previewReturnRef.current = trigger ?? null;
    setPreviewIndex(index);
  }

  function closePreview() {
    setPreviewIndex(null);
    requestAnimationFrame(() => previewReturnRef.current?.focus?.());
  }

  function stepPreview(offset) {
    setPreviewIndex(
      (previewIndex + offset + previewItems.length) % previewItems.length,
    );
  }

  function jumpPreview(position) {
    if (previewItems[position - 1]) {
      setPreviewIndex(position - 1);
    }
  }

  function selectPreviewSide(kind) {
    if (!previewItem) {
      return;
    }

    const index = previewItems.findIndex(
      (item) => item.nodeId === previewItem.nodeId && item.kind === kind,
    );

    if (index >= 0) {
      setPreviewIndex(index);
    }
  }

  async function commitReplace() {
    if (!selected || replacing) {
      return;
    }

    setReplacing(true);

    try {
      await onReplace?.(selected);
    } finally {
      setReplacing(false);
    }
  }

  return (
    <div className="showcase-tray-backdrop" onClick={onClose} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="showcase-tray"
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="showcase-tray-head">
          <div>
            <p className="showcase-tray-kicker">Siblings</p>
            <h2 className="showcase-tray-title" id={titleId}>
              {noteLabel(note)}
            </h2>
            <p className="showcase-tray-sub" role="status">
              {subtitle}
            </p>
          </div>
          <button
            aria-label="Close compare tray"
            className="showcase-tray-close"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              height="16"
              viewBox="0 0 24 24"
              width="16"
            >
              <path
                d="m6 6 12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </header>

        <div className="showcase-tray-body">
          <TrayNoteCard
            collections={collections}
            current
            note={note}
            onOpenPhoto={() => onOpenCurrentImage?.(node)}
          />

          <div className="showcase-tray-list">
            {loading ? (
              <p className="showcase-tray-state">Loading siblings…</p>
            ) : null}
            {!loading && error ? (
              <div className="showcase-tray-error" role="alert">
                <p>{error}</p>
                <button
                  className="button"
                  onClick={() => setAttempt((current) => current + 1)}
                  type="button"
                >
                  Try again
                </button>
              </div>
            ) : null}
            {!loading && !error && siblings.length === 0 ? (
              <p className="showcase-tray-state">No siblings found.</p>
            ) : null}
            {!loading && !error
              ? siblings.map((sibling) => {
                  const isHere = inShowcase.has(sibling.id);

                  return (
                    <TrayNoteCard
                      collections={collections}
                      inShowcase={isHere}
                      key={sibling.id}
                      note={sibling}
                      onOpenPhoto={(trigger, image) =>
                        openPreview(
                          sibling,
                          image?.type === "back" ? "back" : "front",
                          trigger,
                        )
                      }
                      onSelect={() => setSelectedId(sibling.id)}
                      selected={sibling.id === selectedId}
                    />
                  );
                })
              : null}
          </div>
        </div>

        <footer className="showcase-tray-foot">
          <button
            className="showcase-tray-browse"
            onClick={() => onBrowseAll?.(node)}
            type="button"
          >
            Browse all notes…
          </button>
          <div className="showcase-tray-actions">
            <button className="button" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={!selected || replacing}
              onClick={commitReplace}
              type="button"
            >
              {replacing ? "Replacing…" : "Replace note"}
            </button>
          </div>
        </footer>

        {previewItem ? (
          <ImagePopover
            alt={previewItem.alt}
            availableSides={previewItems
              .filter((item) => item.nodeId === previewItem.nodeId)
              .map((item) => item.kind)}
            canGoNext={previewItems.length > 1}
            canGoPrevious={previewItems.length > 1}
            counterPosition={previewIndex + 1}
            counterTotal={previewItems.length}
            noteKey={previewItem.noteId}
            noteLabel={previewItem.noteLabel}
            onClose={closePreview}
            onJump={jumpPreview}
            onNext={() => stepPreview(1)}
            onPrevious={() => stepPreview(-1)}
            onSelectSide={selectPreviewSide}
            side={previewItem.kind}
            src={previewItem.src}
            thumb={previewItem.thumb}
          />
        ) : null}
      </section>
    </div>
  );
}

export { ShowcaseSiblingTray };
