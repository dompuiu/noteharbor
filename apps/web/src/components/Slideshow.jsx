import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getNotes } from '../lib/api.js';

function pickImage(note, type, variant = 'full') {
  return note.images.find((image) => image.type === type && image.variant === variant)?.localPath ?? null;
}

function Slideshow() {
  const location = useLocation();
  const [notes, setNotes] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [side, setSide] = useState('front');
  const [loading, setLoading] = useState(true);

  const ids = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return (searchParams.get('ids') ?? '')
      .split(',')
      .map((value) => Number(value))
      .filter(Boolean);
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
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [ids]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'ArrowRight') {
        setCurrentIndex((current) => (current + 1) % Math.max(notes.length, 1));
      }

      if (event.key === 'ArrowLeft') {
        setCurrentIndex((current) => (current - 1 + Math.max(notes.length, 1)) % Math.max(notes.length, 1));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notes.length]);

  useEffect(() => {
    setSide('front');
  }, [currentIndex]);

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
  const frontImage = pickImage(note, 'front');
  const backImage = pickImage(note, 'back');
  const currentImage = side === 'back' ? backImage || frontImage : frontImage || backImage;

  return (
    <section className="slideshow-screen">
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
          <div className="image-frame">
            {currentImage ? <img alt={`${note.denomination} ${side}`} src={currentImage} /> : <div className="placeholder-card">No scraped image yet</div>}
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
            <div className="inline-actions">
              <button className="button" disabled={!frontImage} onClick={() => setSide('front')} type="button">
                Front
              </button>
              <button className="button" disabled={!backImage} onClick={() => setSide('back')} type="button">
                Back
              </button>
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
