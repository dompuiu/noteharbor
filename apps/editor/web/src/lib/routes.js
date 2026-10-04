export const CATALOG_ROUTES = {
  banknotes: "/catalog/banknotes",
  collections: "/catalog/collections",
  importExport: "/catalog/import-export",
  noteEdit: (id) => `/catalog/notes/${id}/edit`,
};

export const PORTFOLIO_ROUTES = {
  categories: "/portfolio/categories",
  groupings: "/portfolio/groupings",
};

// Where an unknown route lands. This is the first destination of the first
// sidebar group (Catalog > Banknotes); keep it in one place so the catch-all
// and any future default agree.
export const DEFAULT_DESTINATION = CATALOG_ROUTES.banknotes;
