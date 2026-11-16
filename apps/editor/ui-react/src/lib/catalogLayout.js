import { useEffect, useRef, useState } from 'react';
import {
  minWidthForPhotoSize,
  normalizePhotoSize,
} from './photoSize.js';

// The per-browser catalog card layout. It is a display preference only: the
// two layouts are the Library label (identity above the photo, grade in a
// data row) and the Auction rail (identity and grade on a fixed rail beside
// the photo). It never touches the stored Showcase, mirroring the photo size.
const SHOWCASE_CATALOG_LAYOUT_STORAGE_KEY = 'noteharbor.showcaseCatalogLayout';

const CATALOG_LAYOUT_OPTIONS = [
  { value: 'labels', label: 'Library label', icon: 'labels' },
  { value: 'rail', label: 'Auction rail', icon: 'rail' },
];

const DEFAULT_CATALOG_LAYOUT = 'labels';

// The rail's own three-track scale, spaced in even 75px steps. Its fixed
// identity column costs the photo the Small-to-Medium step, so a floored
// Medium would render at exactly the Small width; the rail spaces its tracks
// across the range it can use instead. Large keeps the photo-size Large track.
const CATALOG_LAYOUT_RAIL_WIDTHS = {
  small: 330,
  medium: 405,
  large: 480,
};

const catalogLayoutValues = new Set(
  CATALOG_LAYOUT_OPTIONS.map((option) => option.value),
);

function normalizeCatalogLayout(value) {
  return catalogLayoutValues.has(value) ? value : DEFAULT_CATALOG_LAYOUT;
}

function readStoredCatalogLayout() {
  if (typeof window === 'undefined') {
    return DEFAULT_CATALOG_LAYOUT;
  }

  return normalizeCatalogLayout(
    window.localStorage.getItem(SHOWCASE_CATALOG_LAYOUT_STORAGE_KEY),
  );
}

function writeStoredCatalogLayout(catalogLayout) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SHOWCASE_CATALOG_LAYOUT_STORAGE_KEY,
    normalizeCatalogLayout(catalogLayout),
  );
}

// The grid's minimum card width for the chosen layout: the photo size drives
// it, except the rail uses its own scale so every size stays distinct.
function minWidthForCatalogLayout(catalogLayout, photoSize) {
  const normalizedPhotoSize = normalizePhotoSize(photoSize);

  return normalizeCatalogLayout(catalogLayout) === 'rail'
    ? CATALOG_LAYOUT_RAIL_WIDTHS[normalizedPhotoSize] ??
        CATALOG_LAYOUT_RAIL_WIDTHS.small
    : minWidthForPhotoSize(photoSize);
}

function getDesktopCatalogLayoutBridge() {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridge = window.noteHarborDesktop;
  if (
    !bridge ||
    typeof bridge.getShowcaseCatalogLayout !== 'function' ||
    typeof bridge.setShowcaseCatalogLayout !== 'function'
  ) {
    return null;
  }

  return bridge;
}

// Read the remembered layout once, then persist every change, so the choice
// survives a reload and applies in both view and edit mode.
function useCatalogLayout() {
  const [catalogLayout, setCatalogLayout] = useState(readStoredCatalogLayout);
  // The desktop app serves the web UI from an embedded server on a random
  // port, so each launch is a fresh localStorage origin. Hydrate from the
  // file-backed desktop preference so the choice survives restarts.
  const desktopReadyRef = useRef(false);
  const initialCatalogLayoutRef = useRef(catalogLayout);
  const catalogLayoutRef = useRef(catalogLayout);

  useEffect(() => {
    catalogLayoutRef.current = catalogLayout;
  });

  useEffect(() => {
    const bridge = getDesktopCatalogLayoutBridge();
    if (!bridge) {
      return;
    }

    let cancelled = false;
    bridge
      .getShowcaseCatalogLayout()
      .then((value) => {
        if (cancelled) {
          return;
        }
        // A change made before hydration finished wins over the stored value.
        if (value !== undefined && value !== null) {
          const normalized = normalizeCatalogLayout(value);
          if (
            catalogLayoutRef.current === initialCatalogLayoutRef.current &&
            normalized !== catalogLayoutRef.current
          ) {
            setCatalogLayout(normalized);
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
    writeStoredCatalogLayout(catalogLayout);
    if (desktopReadyRef.current) {
      getDesktopCatalogLayoutBridge()
        ?.setShowcaseCatalogLayout(catalogLayout)
        ?.catch(() => {});
    }
  }, [catalogLayout]);

  return [catalogLayout, setCatalogLayout];
}

export {
  CATALOG_LAYOUT_OPTIONS,
  DEFAULT_CATALOG_LAYOUT,
  SHOWCASE_CATALOG_LAYOUT_STORAGE_KEY,
  getDesktopCatalogLayoutBridge,
  minWidthForCatalogLayout,
  normalizeCatalogLayout,
  useCatalogLayout,
};
