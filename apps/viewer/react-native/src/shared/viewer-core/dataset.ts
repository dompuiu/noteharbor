import type { ViewerDataset } from './models';

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
