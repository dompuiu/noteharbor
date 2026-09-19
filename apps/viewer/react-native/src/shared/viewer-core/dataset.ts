import type { ViewerDataset } from './models';

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Exact port of Flutter's formatFriendlyDatasetBuiltAt
// (apps/viewer/flutter/lib/utils/dataset_date_format.dart).
export function formatFriendlyDatasetBuiltAt(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  const pad = (part: number) => `${part}`.padStart(2, '0');
  return `${monthNames[parsed.getUTCMonth()]} ${pad(parsed.getUTCDate())}, ${parsed.getUTCFullYear()} at ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`;
}

export function describeDatasetBuiltAt(generatedAt: string | null | undefined) {
  if (!generatedAt?.trim()) {
    return 'Not available yet';
  }

  return formatFriendlyDatasetBuiltAt(generatedAt);
}

export function activeCollectionIdForDataset(
  dataset: ViewerDataset | null | undefined,
  currentCollectionId?: number | null,
) {
  const collections = dataset?.collections ?? [];

  if (collections.length === 0) {
    return null;
  }

  if (
    currentCollectionId != null &&
    collections.some((collection) => collection.id === currentCollectionId)
  ) {
    return currentCollectionId;
  }

  const explicitDefault = collections.find((collection) => collection.isDefault);
  if (explicitDefault) {
    return explicitDefault.id;
  }

  const namedDefault = collections.find(
    (collection) => collection.name.trim().toLowerCase() === 'default',
  );
  if (namedDefault) {
    return namedDefault.id;
  }

  return collections[0]?.id ?? null;
}

export function activeCollectionForDataset(
  dataset: ViewerDataset | null | undefined,
  currentCollectionId?: number | null,
) {
  const collections = dataset?.collections ?? [];
  const activeCollectionId = activeCollectionIdForDataset(dataset, currentCollectionId);

  if (activeCollectionId == null) {
    return null;
  }

  return (
    collections.find((collection) => collection.id === activeCollectionId) ??
    collections[0] ??
    null
  );
}

export function activeCollectionNotes(
  dataset: ViewerDataset | null | undefined,
  currentCollectionId?: number | null,
) {
  const notes = dataset?.notes ?? [];
  if (notes.length === 0) {
    return [];
  }

  const activeCollection = activeCollectionForDataset(dataset, currentCollectionId);
  if (!activeCollection) {
    return notes;
  }

  return notes.filter((note) => note.collectionId === activeCollection.id);
}
