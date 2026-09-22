import {
  activeCollectionForDataset,
  activeCollectionIdForDataset,
  activeCollectionNotes,
  datasetSourceLabel,
  filterViewerNotes,
  sortViewerNotes,
  type ViewerCollection,
  type ViewerDataset,
} from '../shared/viewer-core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LocalViewerRepository } from '../data/localViewerRepository';
import type { ViewerRepository } from '../data/viewerRepository';

export interface ViewerControllerState {
  dataset: ViewerDataset | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  query: string;
  setQuery: (value: string) => void;
  activeCollectionId: number | null;
  activeCollection: ViewerCollection | null;
  selectCollection: (collectionId: number) => void;
  sortKey: string;
  ascending: boolean;
  setSort: (key: string) => void;
  filteredNotes: ViewerDataset['notes'];
  sourceLabel: string;
  clearError: () => void;  canManageImportedDatasets: boolean;
  importArchive: (archivePath: string) => Promise<void>;
  deleteCollection: (collectionId: number) => Promise<void>;
  setDefaultCollection: (collectionId: number) => Promise<void>;
  deleteImportedDataset: () => Promise<void>;
}

const defaultRepository = new LocalViewerRepository();

function describeFailure(value: unknown, fallback: string): string {
  // Native rejections (and some JS throws) arrive as plain strings rather
  // than Error objects; surface them verbatim instead of the fallback.
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

export function useViewerController(
  repository: ViewerRepository = defaultRepository,
): ViewerControllerState {
  const [dataset, setDataset] = useState<ViewerDataset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(
    null,
  );
  const [sortKey, setSortKey] = useState('displayOrder');
  const [ascending, setAscending] = useState(true);

  const setSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setAscending((current) => !current);
      } else {
        setSortKey(key);
        setAscending(true);
      }
    },
    [sortKey],
  );

  const loadDataset = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedDataset = await repository.loadDataset();
      setDataset(loadedDataset);
      setSelectedCollectionId((currentCollectionId) =>
        activeCollectionIdForDataset(loadedDataset, currentCollectionId),
      );
    } catch (loadError: unknown) {
      setDataset(null);
      setSelectedCollectionId(null);
      setError(describeFailure(loadError, 'Failed to load dataset.'));
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    repository
      .loadDataset()
      .then((loadedDataset) => {
        if (cancelled) {
          return;
        }

        setDataset(loadedDataset);
        setSelectedCollectionId((currentCollectionId) =>
          activeCollectionIdForDataset(loadedDataset, currentCollectionId),
        );
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        setDataset(null);
        setSelectedCollectionId(null);
        setError(describeFailure(loadError, 'Failed to load dataset.'));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repository]);

  const runMutation = useCallback(
    async (work: () => Promise<ViewerDataset | null>) => {
      setIsMutating(true);
      setError(null);

      try {
        const nextDataset = await work();
        setDataset(nextDataset);
        setSelectedCollectionId((currentCollectionId) =>
          activeCollectionIdForDataset(nextDataset, currentCollectionId),
        );
      } catch (mutationError: unknown) {
        setError(describeFailure(mutationError, 'Dataset mutation failed.'));
      } finally {
        setIsMutating(false);
      }
    },
    [],
  );

  const activeCollectionId = useMemo(
    () => activeCollectionIdForDataset(dataset, selectedCollectionId),
    [dataset, selectedCollectionId],
  );
  const activeCollection = useMemo(
    () => activeCollectionForDataset(dataset, activeCollectionId),
    [dataset, activeCollectionId],
  );
  const filteredNotes = useMemo(() => {
    const notes = activeCollectionNotes(dataset, activeCollectionId);
    return sortViewerNotes(filterViewerNotes(notes, query), sortKey, ascending);
  }, [dataset, activeCollectionId, query, sortKey, ascending]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    dataset,
    isLoading,
    isMutating,
    error,
    query,
    setQuery,
    activeCollectionId,
    activeCollection,
    selectCollection: setSelectedCollectionId,
    sortKey,
    ascending,
    setSort,
    filteredNotes,
    sourceLabel: dataset ? datasetSourceLabel(dataset.source) : 'No dataset loaded',
    clearError,
    canManageImportedDatasets: repository.canManageImportedDatasets ?? true,
    importArchive: async (archivePath: string) => {
      await runMutation(() => repository.importArchive(archivePath));
    },
    deleteCollection: async (collectionId: number) => {
      await runMutation(() => repository.deleteCollection(collectionId));
    },
    setDefaultCollection: async (collectionId: number) => {
      await runMutation(() => repository.setDefaultCollection(collectionId));
    },
    deleteImportedDataset: async () => {
      await runMutation(() => repository.deleteImportedDataset());
    },
  };
}
