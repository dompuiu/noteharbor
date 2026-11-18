import { getTableColumn } from "./tableColumns.js";
import {
  filterNotesByConditions,
  noteOrderValue,
  sortNotesBySort,
} from "./noteView.js";

// The Showcase note picker's own column model: the Table's filterable fields
// plus the cross-collection scope the picker owns. Sharing the condition model
// with the Table keeps Add/Replace, ranges, commas and negation identical,
// while the picker reads notes that only carry this projection.
const pickerColumn = (key, label, overrides = {}) => {
  const base = getTableColumn(key) ?? {};

  return {
    ...base,
    key,
    label,
    sortable: true,
    filterable: true,
    matchMode: base.matchMode ?? "includes",
    multiple: false,
    normalize: base.normalize ?? null,
    isTags: base.isTags ?? false,
    sortValue: base.sortValue ?? null,
    ...overrides,
  };
};

export const pickerColumns = [
  pickerColumn("collection_name", "Collection", {
    sortValue: (note) =>
      Number.isFinite(Number(note.collection_order))
        ? Number(note.collection_order)
        : null,
  }),
  // The picker keeps the catalog-family rule it has always used: 22 matches
  // 22a but never 220, and a letters-only base is a prefix (M, M1, MA).
  pickerColumn("catalog_number", "Catalog #", {
    matchMode: "catalogFamily",
  }),
  pickerColumn("denomination", "Denomination"),
  pickerColumn("issue_date", "Date"),
  pickerColumn("grading_company", "Company"),
  pickerColumn("grade", "Grade"),
  pickerColumn("serial", "Serial"),
  pickerColumn("tags", "Tags"),
];

export const defaultPickerSortKey = "default";

export const pickerSortOptions = [
  { value: defaultPickerSortKey, label: "Default order" },
  ...pickerColumns.map((column) => ({
    value: column.key,
    label: column.label,
  })),
];

// Default order is the collection order from `getAllNotes`, then each
// collection's own display order. Reversing it flips both levels; the
// direction control stays live so the default list can be reversed too.
function compareDefaultOrder(left, right) {
  const leftCollection = Number(left.collection_order);
  const rightCollection = Number(right.collection_order);
  const leftOrder = Number.isFinite(leftCollection)
    ? leftCollection
    : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(rightCollection)
    ? rightCollection
    : Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return noteOrderValue(left) - noteOrderValue(right) || left.id - right.id;
}

// Choosing a field replaces the default order, so an explicit Date sort reads
// as a date sort rather than "owned, then date". Owned-first belongs to the
// default order only; a chosen field takes over completely.
export function applyPickerView(
  noteList,
  {
    conditions = [],
    ownedFirst = false,
    sortDirection = "asc",
    sortKey = defaultPickerSortKey,
  } = {},
) {
  const filtered = filterNotesByConditions(
    noteList,
    conditions,
    pickerColumns,
    { columns: pickerColumns },
  );

  if (sortKey !== defaultPickerSortKey) {
    return sortNotesBySort(filtered, sortKey, sortDirection, {
      columns: pickerColumns,
    });
  }

  const ordered = [...filtered].sort(compareDefaultOrder);

  if (sortDirection === "desc") {
    ordered.reverse();
  }

  if (!ownedFirst) {
    return ordered;
  }

  return ordered.sort(
    (left, right) =>
      Number(Boolean(right.owned)) - Number(Boolean(left.owned)),
  );
}

