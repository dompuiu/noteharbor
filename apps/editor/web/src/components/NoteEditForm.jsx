import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createNote,
  getNotes,
  getNote,
  getTags,
  reorderNotes,
  scrapePreview,
  updateNote,
} from "../lib/api.js";
import {
  copyTextToClipboard,
  formatNoteAsTsvRow,
} from "../lib/noteClipboard.js";
import { PositionPicker } from "./PositionPicker.jsx";

const emptyForm = {
  denomination: "",
  issue_date: "",
  catalog_number: "",
  grading_company: "",
  grade: "",
  watermark: "",
  serial: "",
  url: "",
  notes: "",
  tags: [],
};

const imageSlots = [
  {
    key: "image_front_full",
    type: "front",
    variant: "full",
    label: "Front full",
  },
  { key: "image_back_full", type: "back", variant: "full", label: "Back full" },
  {
    key: "image_front_thumbnail",
    type: "front",
    variant: "thumbnail",
    label: "Front thumbnail",
  },
  {
    key: "image_back_thumbnail",
    type: "back",
    variant: "thumbnail",
    label: "Back thumbnail",
  },
];

function pickImage(images, type, variant) {
  return (
    images.find((image) => image.type === type && image.variant === variant) ??
    null
  );
}

function hasEffectiveImage({ currentImage, pendingImage, isDeleted }) {
  if (pendingImage) {
    return true;
  }

  return Boolean(currentImage) && !isDeleted;
}

function versionedImagePath(path, version) {
  if (!path) {
    return "";
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

function deleteFieldForSlot(slot) {
  return `delete_image_${slot.type}_${slot.variant}`;
}

function generateFieldForType(type) {
  return `generate_image_${type}_thumbnail_from_full`;
}

function slotOriginLabel(origin) {
  if (origin === "scraped") {
    return "Scraped";
  }

  if (origin === "generated") {
    return "Generated";
  }

  return origin === "uploaded" ? "Uploaded" : "";
}

function fieldInputId(name) {
  return `edit-note-${name}`;
}

function NoteEditForm({
  cancelLabel = "Cancel",
  currentNotePosition = null,
  initialPositionMode = "end",
  initialPositionReferenceId = null,
  nextNoteId = null,
  noteId: noteIdProp,
  onCancel,
  onNavigateNext,
  onNavigatePrevious,
  onReady,
  onSaveSuccess,
  overlay = false,
  previousNoteId = null,
  totalNotesInView = 0,
}) {
  const { id: routeNoteId } = useParams();
  const navigate = useNavigate();
  const noteId = noteIdProp ?? routeNoteId;
  const isCreateMode = !noteId;
  const [form, setForm] = useState(emptyForm);
  const [suggestions, setSuggestions] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [currentImages, setCurrentImages] = useState([]);
  const [noteVersion, setNoteVersion] = useState("");
  const [pendingImages, setPendingImages] = useState({});
  const [deletedSlots, setDeletedSlots] = useState({});
  const [generatedThumbnails, setGeneratedThumbnails] = useState({
    front: false,
    back: false,
  });
  const [activePasteSlot, setActivePasteSlot] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [positionMode, setPositionMode] = useState(
    noteId ? "keep" : initialPositionMode,
  );
  const [positionReferenceId, setPositionReferenceId] = useState(
    noteId ? null : initialPositionReferenceId,
  );
  const [scraping, setScraping] = useState(false);
  const [scrapeToast, setScrapeToast] = useState(null);
  const [scrapeDetails, setScrapeDetails] = useState(null);
  const [pendingScrapedImages, setPendingScrapedImages] = useState({});
  const inputRefs = useRef({});
  const firstFieldRef = useRef(null);
  const formElementRef = useRef(null);
  const scrapeToastTimer = useRef(null);

  const wrapperClassName = overlay
    ? "edit-note-overlay-content"
    : "screen-stack narrow-stack";

  const positionNeedsReference =
    positionMode === "before" || positionMode === "after";
  const positionInvalid =
    positionNeedsReference && positionReferenceId === null;
  const canNavigatePrevious = !isCreateMode && Boolean(previousNoteId) && !saving;
  const canNavigateNext = !isCreateMode && Boolean(nextNoteId) && !saving;
  // Notes other than the one being edited — used for both the visibility guard and the picker list
  const otherNotes = allNotes.filter((n) => n.id !== Number(noteId));

  function handleCancel() {
    if (onCancel) {
      onCancel();
      return;
    }

    navigate("/");
  }

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");
    setForm(emptyForm);
    setTagInput("");
    setCurrentImages([]);
    setNoteVersion("");
    setPendingImages({});
    setDeletedSlots({});
    setGeneratedThumbnails({ front: false, back: false });
    setPositionMode(noteId ? "keep" : initialPositionMode);
    setPositionReferenceId(noteId ? null : initialPositionReferenceId);
    setScraping(false);
    setScrapeToast(null);
    setScrapeDetails(null);
    setPendingScrapedImages({});

    const dataPromise = noteId
      ? Promise.all([getNote(noteId), getTags(), getNotes()])
      : Promise.all([Promise.resolve(null), getTags(), getNotes()]);

    dataPromise
      .then(([notePayload, tagsPayload, notesPayload]) => {
        if (!active) {
          return;
        }

        if (notePayload?.note) {
          setForm({
            denomination: notePayload.note.denomination ?? "",
            issue_date: notePayload.note.issue_date ?? "",
            catalog_number: notePayload.note.catalog_number ?? "",
            grading_company: notePayload.note.grading_company ?? "",
            grade: notePayload.note.grade ?? "",
            watermark: notePayload.note.watermark ?? "",
            serial: notePayload.note.serial ?? "",
            url: notePayload.note.url ?? "",
            notes: notePayload.note.notes ?? "",
            tags: notePayload.note.tags.map((tag) => tag.name),
          });
          setCurrentImages(notePayload.note.images ?? []);
          setNoteVersion(notePayload.note.updated_at ?? "");
          if (notePayload.note.scraped_data) {
            setScrapeDetails(notePayload.note.scraped_data);
          }
        }
        setSuggestions(tagsPayload.tags.map((tag) => tag.name));
        setAllNotes(notesPayload.notes ?? []);
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [initialPositionMode, initialPositionReferenceId, noteId]);

  useEffect(() => {
    if (!loading) {
      onReady?.();
    }
  }, [loading, onReady]);

  useEffect(() => {
    if (loading) {
      return;
    }

    firstFieldRef.current?.focus();
  }, [loading, noteId]);

  const imagePreviews = useMemo(() => {
    const nextPreviews = {};

    imageSlots.forEach((slot) => {
      const file = pendingImages[slot.key];
      if (file) {
        nextPreviews[slot.key] = URL.createObjectURL(file);
      }
    });

    return nextPreviews;
  }, [pendingImages]);

  useEffect(
    () => () => {
      Object.values(imagePreviews).forEach((url) => URL.revokeObjectURL(url));
    },
    [imagePreviews],
  );

  useEffect(
    () => () => {
      if (scrapeToastTimer.current) clearTimeout(scrapeToastTimer.current);
    },
    [],
  );

  const filteredSuggestions = useMemo(() => {
    const searchValue = tagInput.trim().toLowerCase();
    return suggestions.filter(
      (tag) =>
        !form.tags.includes(tag) &&
        (!searchValue || tag.toLowerCase().includes(searchValue)),
    );
  }, [form.tags, suggestions, tagInput]);

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function addTag(tagName) {
    const normalized = tagName.trim();
    if (!normalized || form.tags.includes(normalized)) {
      return;
    }

    setForm((current) => ({ ...current, tags: [...current.tags, normalized] }));
    setTagInput("");
  }

  function removeTag(tagName) {
    setForm((current) => ({
      ...current,
      tags: current.tags.filter((tag) => tag !== tagName),
    }));
  }

  function clearScrapedImage(slotKey) {
    setPendingScrapedImages((current) => {
      if (!current[slotKey]) return current;
      const next = { ...current };
      delete next[slotKey];
      return next;
    });
  }

  function setSlotFile(slot, file) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    setPendingImages((current) => ({ ...current, [slot.key]: file }));
    setDeletedSlots((current) => ({ ...current, [slot.key]: false }));
    clearScrapedImage(slot.key);
    if (slot.variant === "thumbnail") {
      setGeneratedThumbnails((current) => ({ ...current, [slot.type]: false }));
    }
    setActivePasteSlot(slot.key);
  }

  function clearSlotFile(slot) {
    setPendingImages((current) => {
      const nextImages = { ...current };
      delete nextImages[slot.key];
      return nextImages;
    });
  }

  function markSlotDeleted(slot) {
    clearSlotFile(slot);
    clearScrapedImage(slot.key);
    setDeletedSlots((current) => ({ ...current, [slot.key]: true }));
    if (slot.variant === "thumbnail") {
      setGeneratedThumbnails((current) => ({ ...current, [slot.type]: false }));
    }
  }

  function undoSlotDelete(slot) {
    setDeletedSlots((current) => ({ ...current, [slot.key]: false }));
  }

  function inferGradingCompany(url) {
    const lower = url.toLowerCase();
    if (lower.includes("pmgnotes.com")) return "PMG";
    if (lower.includes("tqggrading.com")) return "TQG";
    return null;
  }

  function extractCatalogNumberFromPmNote(noteValue) {
    const normalized = String(noteValue ?? "").trim();
    if (!normalized) {
      return null;
    }

    const compact = normalized.replace(/[\s_-]+/g, "");
    const match = compact.match(/(\d+[A-Za-z]*)/);
    return match ? match[1] : null;
  }

  function extractWatermarkFromPmSignaturesVignettes(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/\bWmk:\s*(.+?)(?:\s*[;,|]\s*|$)/i);
    return match?.[1]?.trim() || null;
  }

  function extractPmgDescriptionFields(value) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return {};
    }

    const cleaned = normalized
      .replace(/\s*"SPECIMEN"\s*/gi, " ")
      .replace(/\s+-\s+Wmk:\s*.+$/i, "")
      .trim();

    let issueDate = null;
    let denominationSource = cleaned;
    const ndMatch = cleaned.match(/\bND\s*\(([^)]+)\)\s*$/i);
    if (ndMatch) {
      issueDate = ndMatch[1].trim();
      denominationSource = cleaned.slice(0, ndMatch.index).trim();
    } else {
      const trailingDateMatch = cleaned.match(/(\d{4}(?:\s*-\s*\d{1,4})?)\s*$/);
      if (trailingDateMatch) {
        issueDate = trailingDateMatch[1].replace(/\s+/g, "");
        denominationSource = cleaned.slice(0, trailingDateMatch.index).trim();
      }
    }

    const lastSegment = denominationSource
      .split(",")
      .at(-1)
      ?.trim()
      .replace(/\s+/g, " ") || "";
    const denominationMatch = lastSegment.match(
      /^(\d[\d,./]*\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\b/,
    );
    const denomination = denominationMatch?.[1]?.trim() || null;

    return {
      denomination,
      issueDate,
    };
  }

  function mapScrapedFields(scrapedData, url) {
    const updates = {};
    const d = scrapedData;
    const company = inferGradingCompany(url);
    const pmgDescriptionFields =
      company === "PMG"
        ? extractPmgDescriptionFields(d.note_description ?? d.description)
        : {};

    const grade = d.grade;
    if (grade) updates.grade = grade;

    const serial = d.serial_number ?? d.serial;
    if (serial) updates.serial = serial;

    const pmgNoteCatalogNumber = extractCatalogNumberFromPmNote(d.note);
    const catalogNumber =
      pmgNoteCatalogNumber ??
      d.pmg_cert ??
      d.cert_no ??
      d.certificate_no ??
      d.certificate_number ??
      d.cert;
    if (catalogNumber) updates.catalog_number = catalogNumber;

    const denomination =
      d.denomination ??
      (company === "TQG" ? d.face_value : null) ??
      pmgDescriptionFields.denomination;
    if (denomination) updates.denomination = denomination;

    const issueDate =
      d.issue_date ??
      d.year ??
      d.date ??
      (company === "TQG" ? d.years : null) ??
      pmgDescriptionFields.issueDate;
    if (issueDate) updates.issue_date = issueDate;

    const watermark =
      d.watermark ??
      extractWatermarkFromPmSignaturesVignettes(d.signatures_vignettes);
    if (watermark) updates.watermark = watermark;

    if (company) updates.grading_company = company;

    return updates;
  }

  function showScrapeToast(message) {
    if (scrapeToastTimer.current) {
      clearTimeout(scrapeToastTimer.current);
    }
    setScrapeToast(message);
    scrapeToastTimer.current = setTimeout(() => setScrapeToast(null), 4000);
  }

  async function handleAutoPopulate() {
    setScraping(true);
    setScrapeToast(null);

    try {
      const result = await scrapePreview(form.url);

      setForm((current) => ({
        ...current,
        ...mapScrapedFields(result.scraped_data, form.url),
      }));
      setScrapeDetails(result.scraped_data);

      const nextScrapedImages = {};
      for (const img of result.images) {
        const key = `image_${img.type}_${img.variant}`;
        nextScrapedImages[key] = img.sourceUrl;
      }
      setPendingScrapedImages(nextScrapedImages);
    } catch (err) {
      showScrapeToast(err.message || "Scraping failed.");
    } finally {
      setScraping(false);
    }
  }

  function getPastedImageFile(event) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    return imageItem?.getAsFile() ?? null;
  }

  async function applyPositionAfterSave(savedNoteId) {
    if (positionMode === "keep" || allNotes.length === 0) return null;

    // Re-fetch to avoid using a stale snapshot from form-open time
    const { notes: freshNotes } = await getNotes();
    const withoutSaved = freshNotes
      .filter((n) => n.id !== savedNoteId)
      .map((n) => n.id);

    let nextOrder;

    if (positionMode === "start") {
      nextOrder = [savedNoteId, ...withoutSaved];
    } else if (positionMode === "end") {
      nextOrder = [...withoutSaved, savedNoteId];
    } else {
      const refIndex = withoutSaved.indexOf(positionReferenceId);
      if (refIndex === -1) {
        nextOrder = [...withoutSaved, savedNoteId];
      } else {
        const insertAt = positionMode === "before" ? refIndex : refIndex + 1;
        nextOrder = [
          ...withoutSaved.slice(0, insertAt),
          savedNoteId,
          ...withoutSaved.slice(insertAt),
        ];
      }
    }

    const result = await reorderNotes(nextOrder);
    return result.notes ?? null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payloadWithImages = {
        ...form,
        ...pendingImages,
        scraped_data: scrapeDetails,
      };
      imageSlots.forEach((slot) => {
        if (deletedSlots[slot.key]) {
          payloadWithImages[deleteFieldForSlot(slot)] = true;
        }
      });

      for (const [key, url] of Object.entries(pendingScrapedImages)) {
        if (!pendingImages[key]) {
          payloadWithImages[`${key}_url`] = url;
        }
      }

      ["front", "back"].forEach((type) => {
        if (generatedThumbnails[type]) {
          payloadWithImages[generateFieldForType(type)] = true;
        }
      });

      const payload = isCreateMode
        ? await createNote(payloadWithImages)
        : await updateNote(noteId, payloadWithImages);

      const reorderedNotes = await applyPositionAfterSave(payload.note.id);

      if (onSaveSuccess) {
        onSaveSuccess(payload.note, reorderedNotes);
        return;
      }

      navigate("/");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyNoteDetails() {
    const formData = formElementRef.current
      ? new FormData(formElementRef.current)
      : null;
    const fieldValue = (name, fallback = "") => {
      if (!formData) {
        return fallback;
      }

      const value = formData.get(name);
      return typeof value === "string" ? value : fallback;
    };

    const clipboardValue = formatNoteAsTsvRow({
      denomination: fieldValue("denomination", form.denomination),
      issue_date: fieldValue("issue_date", form.issue_date),
      catalog_number: fieldValue("catalog_number", form.catalog_number),
      grading_company: fieldValue("grading_company", form.grading_company),
      grade: fieldValue("grade", form.grade),
      watermark: fieldValue("watermark", form.watermark),
      serial: fieldValue("serial", form.serial),
      url: fieldValue("url", form.url),
      tags: form.tags,
      notes: fieldValue("notes", form.notes),
    });

    try {
      await copyTextToClipboard(clipboardValue);
      setError("");
    } catch {
      setError("Could not copy note details to clipboard.");
    }
  }

  if (loading) {
    return (
      <section className="panel narrow-stack">
        <p>{isCreateMode ? "Preparing form..." : "Loading note..."}</p>
      </section>
    );
  }

  return (
    <section className={wrapperClassName}>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{isCreateMode ? "Add note" : "Edit note"}</p>
            <h1>
              {isCreateMode
                ? "Add a banknote to the collection"
                : "Adjust collection details"}
            </h1>
          </div>
          <div className="inline-actions">
            {!isCreateMode ? (
              <div className="note-nav-group">
                <button
                  aria-label="Edit previous note"
                  className="icon-link note-nav-arrow"
                  disabled={!canNavigatePrevious}
                  onClick={onNavigatePrevious}
                  title="Previous note"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    height="16"
                    viewBox="0 0 24 24"
                    width="16"
                  >
                    <path
                      d="M15 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
                <span className="note-nav-counter" title="Current note in table view">
                  {currentNotePosition ?? "-"} / {totalNotesInView}
                </span>
                <button
                  aria-label="Edit next note"
                  className="icon-link note-nav-arrow"
                  disabled={!canNavigateNext}
                  onClick={onNavigateNext}
                  title="Next note"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    height="16"
                    viewBox="0 0 24 24"
                    width="16"
                  >
                    <path
                      d="M9 6l6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              </div>
            ) : null}
            {onCancel ? (
              <button
                className="button"
                onClick={handleCancel}
                title={cancelLabel}
                type="button"
              >
                {cancelLabel}
              </button>
            ) : (
              <Link className="button" title={cancelLabel} to="/">
                {cancelLabel}
              </Link>
            )}
            <button
              aria-label="Copy note details"
              className="icon-link"
              onClick={handleCopyNoteDetails}
              title="Copy note details"
              type="button"
            >
              <svg
                aria-hidden="true"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
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
            <button
              className="button button-primary"
              form="edit-note-form"
              disabled={saving || positionInvalid}
              title={isCreateMode ? "Add banknote" : "Save changes"}
              type="submit"
            >
              {saving
                ? isCreateMode
                  ? "Adding..."
                  : "Saving..."
                : isCreateMode
                  ? "Add banknote"
                  : "Save changes"}
            </button>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {scrapeToast ? (
          <div className="scrape-toast scrape-toast--error" role="alert">
            {scrapeToast}
          </div>
        ) : null}

        <form
          className="form-grid"
          id="edit-note-form"
          onSubmit={handleSubmit}
          ref={formElementRef}
        >
          {[
            ["denomination", "Denomination"],
            ["issue_date", "Date"],
            ["catalog_number", "Catalog #"],
            ["grading_company", "Grading Company"],
            ["grade", "Grade"],
            ["watermark", "Watermark"],
            ["serial", "Serial"],
          ].map(([name, label]) => {
            const inputId = fieldInputId(name);

            return (
              <div className="field-block" key={name}>
                <label htmlFor={inputId}>{label}</label>
                <input
                  id={inputId}
                  name={name}
                  onChange={handleFieldChange}
                  ref={name === "denomination" ? firstFieldRef : undefined}
                  value={form[name]}
                />
              </div>
            );
          })}

          <div className="field-block">
            <label htmlFor={fieldInputId("url")}>URL</label>
            <div className="url-field-row">
              <input
                id={fieldInputId("url")}
                name="url"
                onChange={handleFieldChange}
                value={form.url}
              />
              <button
                aria-label="Auto Populate fields from URL"
                className="button"
                disabled={scraping || !form.url.trim()}
                onClick={handleAutoPopulate}
                title="Auto Populate fields from URL"
                type="button"
              >
                {scraping ? (
                  <span className="scrape-spinner" aria-label="Loading" />
                ) : (
                  <span aria-hidden="true">✦</span>
                )}
              </button>
            </div>
          </div>

          <div className="field-block full-span">
            <label htmlFor={fieldInputId("notes")}>Notes</label>
            <textarea
              className="note-textarea"
              id={fieldInputId("notes")}
              name="notes"
              onChange={handleFieldChange}
              rows="4"
              value={form.notes}
            />
          </div>

          <div className="field-block full-span">
            <span>Pictures</span>
            <p className="muted image-field-help">
              Scraped, uploaded, and generated pictures now share the same
              slots. Uploading or scraping a slot replaces what is already
              there.
            </p>
            <div className="image-slot-grid">
              {imageSlots.map((slot) => {
                const currentImage = pickImage(
                  currentImages,
                  slot.type,
                  slot.variant,
                );
                const pendingPreview = imagePreviews[slot.key];
                const isDeleted = Boolean(deletedSlots[slot.key]);
                const pendingFullImage =
                  pendingImages[`image_${slot.type}_full`];
                const fullImage = pickImage(currentImages, slot.type, "full");
                const isFullDeleted = Boolean(
                  deletedSlots[`image_${slot.type}_full`],
                );
                const hasFullImage = hasEffectiveImage({
                  currentImage: fullImage,
                  pendingImage: pendingFullImage,
                  isDeleted: isFullDeleted,
                });
                const scrapedImageUrl = pendingScrapedImages[slot.key];
                const previewSrc = isDeleted
                  ? ""
                  : pendingPreview ||
                    scrapedImageUrl ||
                    versionedImagePath(currentImage?.localPath, noteVersion);
                const hasPendingImage =
                  Boolean(pendingPreview) || Boolean(scrapedImageUrl);
                const hasExistingImage = Boolean(currentImage) && !isDeleted;
                const hasThumbnailImage =
                  Boolean(pendingImages[slot.key]) ||
                  Boolean(scrapedImageUrl) ||
                  (Boolean(currentImage) && !isDeleted);
                const showGenerateOption =
                  slot.variant === "thumbnail" &&
                  hasFullImage &&
                  !hasThumbnailImage;

                return (
                  <div
                    className={`image-slot-card image-slot-card--${slot.variant}`}
                    key={slot.key}
                  >
                    <div className="image-slot-header">
                      <strong>{slot.label}</strong>
                      <div className="image-slot-header-meta">
                        {hasPendingImage ? (
                          <span className="image-slot-badge">
                            New image ready
                          </span>
                        ) : null}
                        {!hasPendingImage &&
                        hasExistingImage &&
                        currentImage?.origin ? (
                          <span
                            className={`image-slot-source image-slot-source--${currentImage.origin}`}
                          >
                            {slotOriginLabel(currentImage.origin)}
                          </span>
                        ) : null}
                        {isDeleted ? (
                          <span className="image-slot-badge image-slot-badge--danger">
                            Will delete
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className={`image-dropzone${activePasteSlot === slot.key ? " image-dropzone--active" : ""}`}
                      onClick={() => {
                        setActivePasteSlot(slot.key);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setActivePasteSlot(slot.key);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setSlotFile(slot, event.dataTransfer.files?.[0]);
                      }}
                      onFocus={() => setActivePasteSlot(slot.key)}
                      onPaste={(event) => {
                        const file = getPastedImageFile(event);
                        if (!file) {
                          return;
                        }

                        event.preventDefault();
                        setSlotFile(slot, file);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActivePasteSlot(slot.key);
                          inputRefs.current[slot.key]?.click();
                        }
                      }}
                    >
                      {previewSrc ? (
                        <img
                          alt={`${slot.label} preview`}
                          className="image-dropzone-preview"
                          src={previewSrc}
                        />
                      ) : (
                        <div className="image-dropzone-empty">
                          {isDeleted ? "Image will be removed" : "No image yet"}
                        </div>
                      )}
                    </div>
                    <div className="image-slot-actions image-slot-actions--wrap">
                      <button
                        className="button"
                        onClick={() => {
                          setActivePasteSlot(slot.key);
                          inputRefs.current[slot.key]?.click();
                        }}
                        type="button"
                      >
                        Choose file
                      </button>
                      <button
                        className="button"
                        disabled={!pendingImages[slot.key]}
                        onClick={() => clearSlotFile(slot)}
                        type="button"
                      >
                        Clear new file
                      </button>
                      {scrapedImageUrl && !pendingImages[slot.key] ? (
                        <button
                          className="button"
                          onClick={() => clearScrapedImage(slot.key)}
                          type="button"
                        >
                          Discard scraped
                        </button>
                      ) : null}
                      <button
                        className="button button-danger-soft"
                        disabled={!hasExistingImage && !hasPendingImage}
                        onClick={() => markSlotDeleted(slot)}
                        type="button"
                      >
                        Delete image
                      </button>
                      <button
                        className="button"
                        disabled={!isDeleted}
                        onClick={() => undoSlotDelete(slot)}
                        type="button"
                      >
                        Undo delete
                      </button>
                      {showGenerateOption ? (
                        <label className="image-generate-toggle image-generate-toggle--inline">
                          <input
                            checked={generatedThumbnails[slot.type]}
                            onChange={(event) =>
                              setGeneratedThumbnails((current) => ({
                                ...current,
                                [slot.type]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <span>Generate thumbnail</span>
                        </label>
                      ) : null}
                    </div>
                    <input
                      accept="image/*"
                      className="image-slot-input"
                      onChange={(event) =>
                        setSlotFile(slot, event.target.files?.[0])
                      }
                      ref={(element) => {
                        inputRefs.current[slot.key] = element;
                      }}
                      type="file"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field-block full-span">
            <span>Tags</span>
            <div className="tag-list editable-tag-list">
              {form.tags.length ? (
                form.tags.map((tag) => (
                  <button
                    className="tag removable-tag"
                    key={tag}
                    onClick={() => removeTag(tag)}
                    type="button"
                  >
                    {tag} x
                  </button>
                ))
              ) : (
                <span className="muted">No tags selected yet.</span>
              )}
            </div>
            <div className="tag-editor">
              <input
                list="tag-suggestions"
                onChange={(event) => setTagInput(event.target.value)}
                placeholder="Type a suggestion and click add"
                value={tagInput}
              />
              <button
                className="button"
                onClick={() => addTag(tagInput)}
                type="button"
              >
                Add tag
              </button>
            </div>
            <datalist id="tag-suggestions">
              {filteredSuggestions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            <div className="suggestion-cloud">
              {filteredSuggestions.slice(0, 16).map((tag) => (
                <button
                  className="tag suggestion-tag"
                  key={tag}
                  onClick={() => addTag(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          {otherNotes.length > 0 ? (
            <div className="field-block full-span">
              <span>Position in collection</span>
              <select
                onChange={(event) => {
                  setPositionMode(event.target.value);
                  setPositionReferenceId(null);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(92, 59, 24, 0.2)",
                  background: "rgba(255, 248, 239, 0.8)",
                }}
                value={positionMode}
              >
                {!isCreateMode ? (
                  <option value="keep">Keep current position</option>
                ) : null}
                <option value="start">Start of collection</option>
                <option value="end">End of collection</option>
                <option value="before">Before a note...</option>
                <option value="after">After a note...</option>
              </select>
              {positionInvalid ? (
                <p
                  className="error-text"
                  style={{ margin: 0, fontSize: "0.85rem" }}
                >
                  Select a reference note from the list below.
                </p>
              ) : null}
              {positionNeedsReference ? (
                <PositionPicker
                  key={positionMode}
                  notes={otherNotes}
                  onSelect={(id) => setPositionReferenceId(id)}
                  selectedId={positionReferenceId}
                />
              ) : null}
            </div>
          ) : null}
        </form>

        {scrapeDetails ? (
          <div className="scraped-details-panel scraped-details-panel--form">
            <h2 className="scraped-details-title">Scraped details</h2>
            <dl className="scraped-details-grid scraped-details-grid--form">
              {Object.entries(scrapeDetails)
                .filter(([, v]) => v != null && v !== "")
                .map(([key, value]) => (
                  <div className="scraped-detail-row" key={key}>
                    <dt>{key.replace(/_/g, " ")}</dt>
                    <dd>
                      {key === "source_url" ? (
                        <a href={value} rel="noreferrer" target="_blank">
                          {value}
                        </a>
                      ) : (
                        String(value)
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export { NoteEditForm };
