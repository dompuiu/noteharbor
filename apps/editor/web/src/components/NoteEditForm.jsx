import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createNote, getNote, getTags, updateNote } from "../lib/api.js";

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
	{ key: "image_front_full", type: "front", variant: "full", label: "Front full" },
	{ key: "image_back_full", type: "back", variant: "full", label: "Back full" },
	{ key: "image_front_thumbnail", type: "front", variant: "thumbnail", label: "Front thumbnail" },
	{ key: "image_back_thumbnail", type: "back", variant: "thumbnail", label: "Back thumbnail" },
];

function pickImage(images, type, variant) {
  return images.find((image) => image.type === type && image.variant === variant) ?? null;
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

function NoteEditForm({
  cancelLabel = "Cancel",
  noteId: noteIdProp,
  onCancel,
  onSaveSuccess,
  overlay = false,
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
  const [generatedThumbnails, setGeneratedThumbnails] = useState({ front: false, back: false });
  const [activePasteSlot, setActivePasteSlot] = useState(null);
  const inputRefs = useRef({});

  const wrapperClassName = overlay
    ? "edit-note-overlay-content"
    : "screen-stack narrow-stack";

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

    const dataPromise = noteId
      ? Promise.all([getNote(noteId), getTags()])
      : Promise.all([Promise.resolve(null), getTags()]);

    dataPromise
      .then(([notePayload, tagsPayload]) => {
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
        }
        setSuggestions(tagsPayload.tags.map((tag) => tag.name));
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
  }, [noteId]);

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

  useEffect(() => () => {
    Object.values(imagePreviews).forEach((url) => URL.revokeObjectURL(url));
  }, [imagePreviews]);

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
    setForm((current) => ({ ...current, tags: current.tags.filter((tag) => tag !== tagName) }));
  }

  function setSlotFile(slot, file) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    setPendingImages((current) => ({ ...current, [slot.key]: file }));
    setDeletedSlots((current) => ({ ...current, [slot.key]: false }));
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
    setDeletedSlots((current) => ({ ...current, [slot.key]: true }));
    if (slot.variant === "thumbnail") {
      setGeneratedThumbnails((current) => ({ ...current, [slot.type]: false }));
    }
  }

  function undoSlotDelete(slot) {
    setDeletedSlots((current) => ({ ...current, [slot.key]: false }));
  }

  function getPastedImageFile(event) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    return imageItem?.getAsFile() ?? null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payloadWithImages = { ...form, ...pendingImages };
      imageSlots.forEach((slot) => {
        if (deletedSlots[slot.key]) {
          payloadWithImages[deleteFieldForSlot(slot)] = true;
        }
      });

      ["front", "back"].forEach((type) => {
        if (generatedThumbnails[type]) {
          payloadWithImages[generateFieldForType(type)] = true;
        }
      });

      const payload = isCreateMode
        ? await createNote(payloadWithImages)
        : await updateNote(noteId, payloadWithImages);

      if (onSaveSuccess) {
        onSaveSuccess(payload.note);
        return;
      }

      navigate("/");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
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
            {onCancel ? (
              <button className="button" onClick={handleCancel} type="button">
                {cancelLabel}
              </button>
            ) : (
              <Link className="button" to="/">
                {cancelLabel}
              </Link>
            )}
            <button
              className="button button-primary"
              form="edit-note-form"
              disabled={saving}
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

        <form className="form-grid" id="edit-note-form" onSubmit={handleSubmit}>
          {[
            ["denomination", "Denomination"],
            ["issue_date", "Date"],
            ["catalog_number", "Catalog #"],
            ["grading_company", "Grading Company"],
            ["grade", "Grade"],
            ["watermark", "Watermark"],
            ["serial", "Serial"],
            ["url", "URL"],
          ].map(([name, label]) => (
            <label className="field-block" key={name}>
              <span>{label}</span>
              <input name={name} onChange={handleFieldChange} value={form[name]} />
            </label>
          ))}

          <label className="field-block full-span">
            <span>Notes</span>
            <textarea name="notes" onChange={handleFieldChange} rows="4" value={form.notes} />
          </label>

          <div className="field-block full-span">
            <span>Pictures</span>
            <p className="muted image-field-help">
              Scraped, uploaded, and generated pictures now share the same slots. Uploading or scraping a slot replaces what is already there.
            </p>
            <div className="image-slot-grid">
              {imageSlots.map((slot) => {
                const currentImage = pickImage(currentImages, slot.type, slot.variant);
                const pendingPreview = imagePreviews[slot.key];
                const isDeleted = Boolean(deletedSlots[slot.key]);
                const pendingFullImage = pendingImages[`image_${slot.type}_full`];
                const fullImage = pickImage(currentImages, slot.type, "full");
                const isFullDeleted = Boolean(deletedSlots[`image_${slot.type}_full`]);
                const hasFullImage = hasEffectiveImage({
                  currentImage: fullImage,
                  pendingImage: pendingFullImage,
                  isDeleted: isFullDeleted,
                });
                const previewSrc = isDeleted
                  ? ""
                  : pendingPreview || versionedImagePath(currentImage?.localPath, noteVersion);
                const hasPendingImage = Boolean(pendingPreview);
                const hasExistingImage = Boolean(currentImage) && !isDeleted;
                const hasThumbnailImage = Boolean(pendingImages[slot.key]) || (Boolean(currentImage) && !isDeleted);
                const showGenerateOption = slot.variant === "thumbnail" && hasFullImage && !hasThumbnailImage;

                return (
                  <div className={`image-slot-card image-slot-card--${slot.variant}`} key={slot.key}>
                    <div className="image-slot-header">
                      <strong>{slot.label}</strong>
                      <div className="image-slot-header-meta">
                        {hasPendingImage ? <span className="image-slot-badge">New image ready</span> : null}
                        {!hasPendingImage && hasExistingImage && currentImage?.origin ? (
                          <span className={`image-slot-source image-slot-source--${currentImage.origin}`}>
                            {slotOriginLabel(currentImage.origin)}
                          </span>
                        ) : null}
                        {isDeleted ? <span className="image-slot-badge image-slot-badge--danger">Will delete</span> : null}
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
                        <img alt={`${slot.label} preview`} className="image-dropzone-preview" src={previewSrc} />
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
                      onChange={(event) => setSlotFile(slot, event.target.files?.[0])}
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
                  <button className="tag removable-tag" key={tag} onClick={() => removeTag(tag)} type="button">
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
              <button className="button" onClick={() => addTag(tagInput)} type="button">
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
                <button className="tag suggestion-tag" key={tag} onClick={() => addTag(tag)} type="button">
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

export { NoteEditForm };
