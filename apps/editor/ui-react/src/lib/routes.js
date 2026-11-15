export const CATALOG_ROUTES = {
  allNotes: "/catalog/all-notes",
  collections: "/catalog/collections",
  collection: (id) => `/catalog/collections/${id}/view`,
  collectionEdit: (id) => `/catalog/collections/${id}/edit`,
  noteSlideshow: (collectionId, noteId) =>
    `/catalog/collections/${collectionId}/view#slideshow/${noteId}`,
  importExport: "/catalog/import-export",
  noteEdit: (id) => `/catalog/notes/${id}/edit`,
};

// The Showcases hub's routes. A showcase is one always-editable view: the
// canvas saves each add, rename, remove, and reorder as it happens. The old
// `edit` segment survives only as a redirect for bookmarks.
export const SHOWCASE_ROUTES = {
  showcases: "/portfolio/showcases",
  showcase: (id) => `/portfolio/showcases/${id}/view`,
  showcaseEdit: (id) => `/portfolio/showcases/${id}/edit`,
};

// View-mode drill is URL-synced through a single query parameter: the current
// node is `?node=<id>` and the root has no parameter. A null id clears it.
export function showcaseNodeSearch(nodeId) {
  return nodeId == null ? "" : `?node=${nodeId}`;
}

// The retired `new` draft id. `+ New showcase` now posts immediately and opens
// the real id; this constant only redirects old `/new/edit` bookmarks.
export const NEW_SHOWCASE_ID = "new";

// A not-yet-saved collection lives at this id. `+ New collection` opens
// `/catalog/collections/new/edit` with a sidebar draft row; Save POSTs the
// collection and navigates to its real id, while Cancel (or leaving the route)
// discards the draft without touching the server.
export const NEW_COLLECTION_ID = "new";

// Where an unknown route lands. This is the collections home: it resolves to
// the first collection view (or the empty-library prompt when there are no
// collections), so the catch-all and any future default agree.
export const DEFAULT_DESTINATION = CATALOG_ROUTES.collections;
