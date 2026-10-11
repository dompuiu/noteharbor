import { useEffect, useRef, useState } from 'react';

// The per-browser note photo size. It is a display preference only: it sets the
// grid's minimum card width and never touches the stored Showcase, mirroring the
// Banknotes table state and the active collection id.
const SHOWCASE_PHOTO_SIZE_STORAGE_KEY = 'noteharbor.showcasePhotoSize';

// Small is the default; the pixel values are the grid's minmax() minimum.
const PHOTO_SIZE_OPTIONS = [
  { value: 'small', label: 'Small', minWidth: 200 },
  { value: 'medium', label: 'Medium', minWidth: 320 },
  { value: 'large', label: 'Large', minWidth: 480 },
];

const DEFAULT_PHOTO_SIZE = 'small';

const photoSizeValues = new Set(PHOTO_SIZE_OPTIONS.map((option) => option.value));

function normalizePhotoSize(value) {
  return photoSizeValues.has(value) ? value : DEFAULT_PHOTO_SIZE;
}

function readStoredPhotoSize() {
  if (typeof window === 'undefined') {
    return DEFAULT_PHOTO_SIZE;
  }

  return normalizePhotoSize(
    window.localStorage.getItem(SHOWCASE_PHOTO_SIZE_STORAGE_KEY),
  );
}

function writeStoredPhotoSize(photoSize) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SHOWCASE_PHOTO_SIZE_STORAGE_KEY,
    normalizePhotoSize(photoSize),
  );
}

function minWidthForPhotoSize(photoSize) {
  const normalized = normalizePhotoSize(photoSize);
  const option = PHOTO_SIZE_OPTIONS.find((entry) => entry.value === normalized);
  return option.minWidth;
}

function getDesktopPhotoSizeBridge() {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridge = window.noteHarborDesktop;
  if (
    !bridge ||
    typeof bridge.getShowcasePhotoSize !== 'function' ||
    typeof bridge.setShowcasePhotoSize !== 'function'
  ) {
    return null;
  }

  return bridge;
}

// Read the remembered size once, then persist every change, so the choice
// survives a reload and applies in both view and edit mode.
function usePhotoSize() {
  const [photoSize, setPhotoSize] = useState(readStoredPhotoSize);
  // The desktop app serves the web UI from an embedded server on a random
  // port, so each launch is a fresh localStorage origin. Hydrate from the
  // file-backed desktop preference so the choice survives restarts.
  const desktopReadyRef = useRef(false);
  const initialPhotoSizeRef = useRef(photoSize);
  const photoSizeRef = useRef(photoSize);

  useEffect(() => {
    photoSizeRef.current = photoSize;
  });

  useEffect(() => {
    const bridge = getDesktopPhotoSizeBridge();
    if (!bridge) {
      return;
    }

    let cancelled = false;
    bridge
      .getShowcasePhotoSize()
      .then((value) => {
        if (cancelled) {
          return;
        }
        // A change made before hydration finished wins over the stored value.
        if (value !== undefined && value !== null) {
          const normalized = normalizePhotoSize(value);
          if (photoSizeRef.current === initialPhotoSizeRef.current && normalized !== photoSizeRef.current) {
            setPhotoSize(normalized);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          desktopReadyRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeStoredPhotoSize(photoSize);
    if (desktopReadyRef.current) {
      getDesktopPhotoSizeBridge()?.setShowcasePhotoSize(photoSize)?.catch(() => {});
    }
  }, [photoSize]);

  return [photoSize, setPhotoSize];
}

export {
  DEFAULT_PHOTO_SIZE,
  PHOTO_SIZE_OPTIONS,
  SHOWCASE_PHOTO_SIZE_STORAGE_KEY,
  getDesktopPhotoSizeBridge,
  minWidthForPhotoSize,
  normalizePhotoSize,
  usePhotoSize,
};
