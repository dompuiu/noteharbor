import { Router } from 'express';
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  renameCategory
} from '../db.js';

// The workspace's shared Category labels. A label is never deleted: removing a
// Placement leaves the label in this pool for reuse (spec §Deletion).
const categoriesRouter = Router();

function normalizeName(value) {
  return String(value ?? '').trim();
}

categoriesRouter.get('/', (_request, response) => {
  response.json({ categories: getAllCategories() });
});

categoriesRouter.post('/', (request, response) => {
  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Category name is required.' });
    return;
  }

  try {
    // A name that already exists (ignoring case) comes back as the existing
    // label, so this is get-or-create rather than a duplicate-name error.
    const category = createCategory(name);
    response.status(201).json({ category });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

categoriesRouter.put('/:id', (request, response) => {
  const id = Number(request.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'Category id must be a positive integer.' });
    return;
  }

  if (!getCategoryById(id)) {
    response.status(404).json({ error: 'Category not found.' });
    return;
  }

  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Category name is required.' });
    return;
  }

  try {
    const category = renameCategory(id, name);
    response.json({ category });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

export { categoriesRouter };
