import { useEffect, useState } from "react";

function pickImage(note, type, variant = "full") {
  return (
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null
  );
}

function ImagePopover({ src, alt, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="image-popover-overlay" onClick={onClose}>
      <div
        className="image-popover-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="image-popover-close" onClick={onClose} type="button">
          x
        </button>
        <img alt={alt} src={src} />
      </div>
    </div>
  );
}

function Slideshow({ currentIndex, notes, onChangeIndex, onClose }) {
  const [popoverImage, setPopoverImage] = useState(null);

  useEffect(() => {
    function onKeyDown(event) {
      if (popoverImage) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowRight") {
        onChangeIndex((current) => (current + 1) % Math.max(notes.length, 1));
      }

      if (event.key === "ArrowLeft") {
        onChangeIndex(
          (current) =>
            (current - 1 + Math.max(notes.length, 1)) % Math.max(notes.length, 1),
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notes.length, onChangeIndex, onClose, popoverImage]);

  if (!notes.length) {
    return null;
  }

  const note = notes[currentIndex];
  const frontFull = pickImage(note, "front", "full");
  const backFull = pickImage(note, "back", "full");
  const frontThumb = pickImage(note, "front", "thumbnail") || frontFull;
  const backThumb = pickImage(note, "back", "thumbnail") || backFull;

  return (
    <section className="slideshow-screen slideshow-screen--overlay">
      {popoverImage && (
        <ImagePopover
          src={popoverImage.src}
          alt={popoverImage.alt}
          onClose={() => setPopoverImage(null)}
        />
      )}

      <div className="slideshow-topbar">
        <button className="slideshow-exit-button" onClick={onClose} type="button">
          Exit slideshow
        </button>
        <div className="counter-pill">
          {currentIndex + 1} / {notes.length}
        </div>
      </div>

      <div className="slideshow-layout">
        <button
          className="arrow-button"
          onClick={() =>
            onChangeIndex((current) => (current - 1 + notes.length) % notes.length)
          }
          type="button"
        >
          <span aria-hidden="true">&larr;</span>
        </button>

        <div className="slide-card">
          <div className="slide-images">
            {frontThumb || backThumb ? (
              <>
                {frontThumb && (
                  <button
                    className="slide-thumb-btn"
                    onClick={() =>
                      setPopoverImage({
                        src: frontFull || frontThumb,
                        alt: `${note.denomination} front`,
                      })
                    }
                    title="Click to enlarge"
                    type="button"
                  >
                    <img alt={`${note.denomination} front`} src={frontThumb} />
                    <span className="slide-thumb-label">Front</span>
                  </button>
                )}
                {backThumb && (
                  <button
                    className="slide-thumb-btn"
                    onClick={() =>
                      setPopoverImage({
                        src: backFull || backThumb,
                        alt: `${note.denomination} back`,
                      })
                    }
                    title="Click to enlarge"
                    type="button"
                  >
                    <img alt={`${note.denomination} back`} src={backThumb} />
                    <span className="slide-thumb-label">Back</span>
                  </button>
                )}
              </>
            ) : (
              <div className="placeholder-card">No scraped image yet</div>
            )}
          </div>

          <div className="slide-meta">
            <div>
              <p className="eyebrow">{note.grading_company || "Collection note"}</p>
              <h1>{note.denomination}</h1>
              <p>{note.issue_date}</p>
            </div>
            <div className="detail-grid">
              <p><strong>Catalog:</strong> {note.catalog_number || "-"}</p>
              <p><strong>Grade:</strong> {note.grade || "-"}</p>
              <p><strong>Serial:</strong> {note.serial || "-"}</p>
              <p><strong>Watermark:</strong> {note.watermark || "-"}</p>
            </div>
            <p>{note.notes || "No extra notes."}</p>
            <div className="tag-list">
              {note.tags.map((tag) => (
                <span className="tag" key={tag.id || tag.name}>{tag.name}</span>
              ))}
            </div>
          </div>
        </div>

        <button
          className="arrow-button"
          onClick={() => onChangeIndex((current) => (current + 1) % notes.length)}
          type="button"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </section>
  );
}

export { Slideshow };
