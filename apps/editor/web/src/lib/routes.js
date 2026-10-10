export const CATALOG_ROUTES = {
  banknotes: "/catalog/banknotes",
  collections: "/catalog/collections",
  collection: (id) => `/catalog/collections/${id}/view`,
  collectionEdit: (id) => `/catalog/collections/${id}/edit`,
  importExport: "/catalog/import-export",
  noteEdit: (id) => `/catalog/notes/${id}/edit`,
};

// The Showcases hub's routes. View mode is read-only; edit mode adds the
// authoring controls. Both modes hang off the same showcase path with a
// trailing `view` / `edit` segment, so switching modes is a one-word swap that
// stays on the same screen. The `portfolio` prefix is kept for continuity with
// the Catalog prefix, but the old `categories` / `groupings` destinations retire.
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

// A not-yet-saved showcase lives at this id. `+ New showcase` opens
// `/portfolio/showcases/new/edit` with a sidebar draft row; Save POSTs the
// showcase and navigates to its real id, while Cancel (or leaving the route)
// discards the draft without touching the server.
export const NEW_SHOWCASE_ID = "new";

// A not-yet-saved collection lives at this id. `+ New collection` opens
// `/catalog/collections/new/edit` with a sidebar draft row; Save POSTs the
// collection and navigates to its real id, while Cancel (or leaving the route)
// discards the draft without touching the server.
export const NEW_COLLECTION_ID = "new";

// Where an unknown route lands. This is the first destination of the first
// sidebar group (Catalog > Banknotes); keep it in one place so the catch-all
// and any future default agree.
export const DEFAULT_DESTINATION = CATALOG_ROUTES.banknotes;
