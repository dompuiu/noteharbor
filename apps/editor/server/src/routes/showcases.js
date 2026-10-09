import { Router } from 'express';
import {
  createShowcase,
  deleteShowcaseById,
  getAllShowcases,
  getShowcaseById,
  renameShowcaseById,
  reorderShowcases,
} from '../db.js';

const showcasesRouter = Router();

function normalizeName(value) {
  return String(value ?? '').trim();
}

function readShowcaseId(request, response) {
  const showcaseId = Number(request.params.showcaseId);

  if (!Number.isInteger(showcaseId) || showcaseId <= 0) {
    response.status(400).json({ error: 'A valid showcase ID is required.' });
    return null;
  }

  return showcaseId;
}

showcasesRouter.get('/', (_request, response) => {
  response.json({ showcases: getAllShowcases() });
});

showcasesRouter.post('/', (request, response) => {
  const name = normalizeName(request.body?.name);

  try {
    // An omitted name gets a unique default; the name is optional so the
    // sidebar's `+ New showcase` can create and open one in a single step.
    const showcase = createShowcase(name);
    response.status(201).json({ showcase });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

showcasesRouter.put('/order', (request, response) => {
  const ids = Array.isArray(request.body.ids) ? request.body.ids : null;

  if (!ids) {
    response
      .status(400)
      .json({ error: 'A full ordered list of showcase IDs is required.' });
    return;
  }

  try {
    const showcases = reorderShowcases(ids);
    response.json({ showcases });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

showcasesRouter.put('/:showcaseId', (request, response) => {
  const showcaseId = readShowcaseId(request, response);

  if (showcaseId === null) {
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Showcase name is required.' });
    return;
  }

  try {
    const showcase = renameShowcaseById(showcaseId, name);
    response.json({ showcase });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

showcasesRouter.delete('/:showcaseId', (request, response) => {
  const showcaseId = readShowcaseId(request, response);

  if (showcaseId === null) {
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  try {
    deleteShowcaseById(showcaseId);
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

export { showcasesRouter };
