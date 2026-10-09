import { Router } from 'express';
import { createShowcase, getAllShowcases } from '../db.js';

const showcasesRouter = Router();

function normalizeName(value) {
  return String(value ?? '').trim();
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

export { showcasesRouter };
