import { Router } from 'express';
import {
  createCollection,
  deleteCollectionById,
  getAllCollections,
  getCollectionById,
  renameCollectionById,
  setDefaultCollectionById
} from '../db.js';

const collectionsRouter = Router();

function normalizeName(value) {
  return String(value ?? '').trim();
}

collectionsRouter.get('/', (_request, response) => {
  response.json({ collections: getAllCollections() });
});

collectionsRouter.post('/', (request, response) => {
  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Collection name is required.' });
    return;
  }

  try {
    const collection = createCollection(name);
    response.status(201).json({ collection });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

collectionsRouter.put('/:collectionId', (request, response) => {
  const collectionId = Number(request.params.collectionId);

  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    response.status(400).json({ error: 'A valid collection ID is required.' });
    return;
  }

  if (!getCollectionById(collectionId)) {
    response.status(404).json({ error: 'Collection not found.' });
    return;
  }

  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Collection name is required.' });
    return;
  }

  try {
    const collection = renameCollectionById(collectionId, name);
    response.json({ collection });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

collectionsRouter.put('/:collectionId/default', (request, response) => {
  const collectionId = Number(request.params.collectionId);

  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    response.status(400).json({ error: 'A valid collection ID is required.' });
    return;
  }

  if (!getCollectionById(collectionId)) {
    response.status(404).json({ error: 'Collection not found.' });
    return;
  }

  try {
    const collection = setDefaultCollectionById(collectionId);
    response.json({ collection });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

collectionsRouter.delete('/:collectionId', (request, response) => {
  const collectionId = Number(request.params.collectionId);

  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    response.status(400).json({ error: 'A valid collection ID is required.' });
    return;
  }

  if (!getCollectionById(collectionId)) {
    response.status(404).json({ error: 'Collection not found.' });
    return;
  }

  try {
    deleteCollectionById(collectionId);
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

export { collectionsRouter };
