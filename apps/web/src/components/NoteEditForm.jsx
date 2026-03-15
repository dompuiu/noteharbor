import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getNote, getTags, updateNote } from "../lib/api.js";

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
  const [form, setForm] = useState(emptyForm);
  const [suggestions, setSuggestions] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

    if (!noteId) {
      setError("Note not found.");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");
    setForm(emptyForm);
    setTagInput("");

    Promise.all([getNote(noteId), getTags()])
      .then(([notePayload, tagsPayload]) => {
        if (!active) {
          return;
        }

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

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = await updateNote(noteId, form);

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
        <p>Loading note...</p>
      </section>
    );
  }

  return (
    <section className={wrapperClassName}>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Edit note</p>
            <h1>Adjust collection details</h1>
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
              {saving ? "Saving..." : "Save changes"}
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
