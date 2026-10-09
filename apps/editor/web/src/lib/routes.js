export const CATALOG_ROUTES = {
  banknotes: "/catalog/banknotes",
  collections: "/catalog/collections",
  importExport: "/catalog/import-export",
  noteEdit: (id) => `/catalog/notes/${id}/edit`,
};

// The Showcases hub's routes. View mode is read-only; edit mode adds the
// authoring controls. The `portfolio` prefix is kept for continuity with the
// Catalog prefix, but the old `categories` / `groupings` destinations retire.
export const PORTFOLIO_ROUTES = {
  showcases: "/portfolio/showcases",
  showcase: (id) => `/portfolio/showcases/${id}`,
  showcaseEdit: (id) => `/portfolio/showcases/${id}/edit`,
};

// Where an unknown route lands. This is the first destination of the first
// sidebar group (Catalog > Banknotes); keep it in one place so the catch-all
// and any future default agree.
export const DEFAULT_DESTINATION = CATALOG_ROUTES.banknotes;
