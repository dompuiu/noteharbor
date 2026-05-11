import { Router } from 'express';
import {
  getAllTags,
  getCollectionById,
  getDefaultCollectionId
} from '../db.js';

const tagsRouter = Router({ mergeParams: true });

function resolveCollectionId(request, response) {
  const rawCollectionId = request.params.collectionId;

  if (rawCollectionId == null) {
    return getDefaultCollectionId();
  }

  const collectionId = Number(rawCollectionId);

  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    response.status(400).json({ error: 'A valid collection ID is required.' });
    return null;
  }

  if (!getCollectionById(collectionId)) {
    response.status(404).json({ error: 'Collection not found.' });
    return null;
  }

  return collectionId;
}

tagsRouter.get('/', (request, response) => {
  const collectionId = resolveCollectionId(request, response);

  if (!collectionId) {
    return;
  }

  response.json({ tags: getAllTags(collectionId) });
});

tagsRouter.get('/suggestions', (request, response) => {
  const collectionId = resolveCollectionId(request, response);

  if (!collectionId) {
    return;
  }

  response.json({ tags: getAllTags(collectionId) });
});

export { tagsRouter };
