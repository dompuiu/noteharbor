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
  filteredNotes: ViewerDataset['notes'];
  sourceLabel: string;
  importArchive: (archivePath: string) => Promise<void>;
  deleteCollection: (collectionId: number) => Promise<void>;
  setDefaultCollection: (collectionId: number) => Promise<void>;
  deleteImportedDataset: () => Promise<void>;
}

const defaultRepository = new LocalViewerRepository();

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
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load dataset.',
      );
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
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load dataset.',
        );
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
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : 'Dataset mutation failed.',
        );
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
    return sortViewerNotes(filterViewerNotes(notes, query), 'displayOrder', true);
  }, [dataset, activeCollectionId, query]);

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
    filteredNotes,
    sourceLabel: dataset ? datasetSourceLabel(dataset.source) : 'No dataset loaded',
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
