// The two list projections the screens ask for. The server builds its SELECT
// from the requested names, so a field listed here is the only kind of note
// data that travels with a list. Both lists keep the full image array (the
// table paints a thumbnail from it and the showcase picker previews from it);
// the scraped payload never travels with either.

// The All notes table paints these columns, sorts on display_order, and its
// slideshow reads watermark. The note text stays behind too: the slideshow
// fetches the full note when a row is opened.
export const allNotesListFields = [
  "id",
  "collection_id",
  "display_order",
  "catalog_number",
  "denomination",
  "issue_date",
  "grading_company",
  "grade",
  "watermark",
  "serial",
  "url",
  "images",
  "updated_at",
  "tags",
];

// The showcase picker paints a card per note: image, label, description and
// tags. It never reads the scraped payload.
export const showcasePickerFields = [
  "id",
  "collection_id",
  "catalog_number",
  "denomination",
  "issue_date",
  "images",
  "updated_at",
  "notes",
  "tags",
];
