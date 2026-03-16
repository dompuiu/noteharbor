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
  { key: "image_front_thumbnail", type: "front", variant: "thumbnail", label: "Front thumbnail" },
  { key: "image_back_thumbnail", type: "back", variant: "thumbnail", label: "Back thumbnail" },
  { key: "image_front_full", type: "front", variant: "full", label: "Front full" },
  { key: "image_back_full", type: "back", variant: "full", label: "Back full" },
];

function pickImage(images, type, variant) {
  return images.find((image) => image.type === type && image.variant === variant) ?? null;
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
  const [pendingImages, setPendingImages] = useState({});
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
    setPendingImages({});

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
    setTagInput('');
  }

  function removeTag(tagName) {
    setForm((current) => ({ ...current, tags: current.tags.filter((tag) => tag !== tagName) }));
  }

  function setSlotFile(slotKey, file) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    setPendingImages((current) => ({ ...current, [slotKey]: file }));
    setActivePasteSlot(slotKey);
  }

  function clearSlotFile(slotKey) {
    setPendingImages((current) => {
      const nextImages = { ...current };
      delete nextImages[slotKey];
      return nextImages;
    });
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
              Existing images stay visible here. Click a slot, then drag, drop, or press Ctrl+V to replace it.
            </p>
            <div className="image-slot-grid">
              {imageSlots.map((slot) => {
                const currentImage = pickImage(currentImages, slot.type, slot.variant);
                const pendingPreview = imagePreviews[slot.key];
                const previewSrc = pendingPreview || currentImage?.localPath || "";
                const hasPendingImage = Boolean(pendingPreview);

                return (
                  <div className={`image-slot-card image-slot-card--${slot.variant}`} key={slot.key}>
                    <div className="image-slot-header">
                      <strong>{slot.label}</strong>
                      {hasPendingImage ? <span className="image-slot-badge">New image ready</span> : null}
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
                        setSlotFile(slot.key, event.dataTransfer.files?.[0]);
                      }}
                      onFocus={() => setActivePasteSlot(slot.key)}
                      onPaste={(event) => {
                        const file = getPastedImageFile(event);
                        if (!file) {
                          return;
                        }

                        event.preventDefault();
                        setSlotFile(slot.key, file);
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
                        <div className="image-dropzone-empty">No image yet</div>
                      )}
                    </div>
                    <div className="image-slot-actions">
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
                        onClick={() => clearSlotFile(slot.key)}
                        type="button"
                      >
                        Clear new file
                      </button>
                    </div>
                    <input
                      accept="image/*"
                      className="image-slot-input"
                      onChange={(event) => setSlotFile(slot.key, event.target.files?.[0])}
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
