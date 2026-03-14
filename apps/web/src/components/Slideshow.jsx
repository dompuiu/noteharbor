import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getNotes } from '../lib/api.js';

function pickImage(note, type, variant = 'full') {
  return note.images.find((image) => image.type === type && image.variant === variant)?.localPath ?? null;
}

function ImagePopover({ src, alt, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="image-popover-overlay" onClick={onClose}>
      <div className="image-popover-content" onClick={(e) => e.stopPropagation()}>
        <button className="image-popover-close" onClick={onClose} type="button">✕</button>
        <img alt={alt} src={src} />
      </div>
    </div>
  );
}

function Slideshow() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notes, setNotes] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [popoverImage, setPopoverImage] = useState(null);

  const ids = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return (searchParams.get('ids') ?? '')
      .split(',')
      .map((value) => Number(value))
      .filter(Boolean);
  }, [location.search]);

  const startId = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const value = Number(searchParams.get('start'));
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [location.search]);

  useEffect(() => {
    let active = true;

    getNotes()
      .then((payload) => {
        if (!active) {
          return;
        }

        const noteMap = new Map(payload.notes.map((note) => [note.id, note]));
        const orderedNotes = ids.length ? ids.map((id) => noteMap.get(id)).filter(Boolean) : payload.notes;
        setNotes(orderedNotes);

        if (startId) {
          const startIndex = orderedNotes.findIndex((note) => note.id === startId);
          setCurrentIndex(startIndex >= 0 ? startIndex : 0);
        } else {
          setCurrentIndex(0);
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
  }, [ids, startId]);

  useEffect(() => {
    function onKeyDown(event) {
      if (popoverImage) return;
      if (event.key === 'Escape') {
        navigate('/');
        return;
      }
      if (event.key === 'ArrowRight') {
        setCurrentIndex((current) => (current + 1) % Math.max(notes.length, 1));
      }
      if (event.key === 'ArrowLeft') {
        setCurrentIndex((current) => (current - 1 + Math.max(notes.length, 1)) % Math.max(notes.length, 1));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, notes.length, popoverImage]);

  if (loading) {
    return <section className="slideshow-screen"><p>Loading slideshow...</p></section>;
  }

  if (!notes.length) {
    return (
      <section className="slideshow-screen">
        <p>No notes are available for the slideshow.</p>
        <Link className="button" to="/">
          Back to table
        </Link>
      </section>
    );
  }

  const note = notes[currentIndex];
  const frontFull = pickImage(note, 'front', 'full');
  const backFull = pickImage(note, 'back', 'full');
  const frontThumb = pickImage(note, 'front', 'thumbnail') || frontFull;
  const backThumb = pickImage(note, 'back', 'thumbnail') || backFull;

  return (
    <section className="slideshow-screen">
      {popoverImage && (
        <ImagePopover
          src={popoverImage.src}
          alt={popoverImage.alt}
          onClose={() => setPopoverImage(null)}
        />
      )}

      <div className="slideshow-topbar">
        <Link className="button" to="/">
          Exit slideshow
        </Link>
        <div className="counter-pill">
          {currentIndex + 1} / {notes.length}
        </div>
      </div>

      <div className="slideshow-layout">
        <button className="arrow-button" onClick={() => setCurrentIndex((current) => (current - 1 + notes.length) % notes.length)} type="button">
          ←
        </button>

        <div className="slide-card">
          <div className="slide-images">
            {frontThumb || backThumb ? (
              <>
                {frontThumb && (
                  <button
                    className="slide-thumb-btn"
                    onClick={() => setPopoverImage({ src: frontFull || frontThumb, alt: `${note.denomination} front` })}
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
                    onClick={() => setPopoverImage({ src: backFull || backThumb, alt: `${note.denomination} back` })}
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
              <p className="eyebrow">{note.grading_company || 'Collection note'}</p>
              <h1>{note.denomination}</h1>
              <p>{note.issue_date}</p>
            </div>
            <div className="detail-grid">
              <p><strong>Catalog:</strong> {note.catalog_number || '-'}</p>
              <p><strong>Grade:</strong> {note.grade || '-'}</p>
              <p><strong>Serial:</strong> {note.serial || '-'}</p>
              <p><strong>Watermark:</strong> {note.watermark || '-'}</p>
            </div>
            <p>{note.notes || 'No extra notes.'}</p>
            <div className="tag-list">
              {note.tags.map((tag) => (
                <span className="tag" key={tag.id || tag.name}>{tag.name}</span>
              ))}
            </div>
          </div>
        </div>

        <button className="arrow-button" onClick={() => setCurrentIndex((current) => (current + 1) % notes.length)} type="button">
          →
        </button>
      </div>
    </section>
  );
}

export { Slideshow };
