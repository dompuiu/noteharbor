import { Router } from 'express';
import { getAllTags } from '../db.js';

const tagsRouter = Router();

tagsRouter.get('/', (_request, response) => {
  response.json({ tags: getAllTags() });
});

tagsRouter.get('/suggestions', (_request, response) => {
  response.json({ tags: getAllTags() });
});

export { tagsRouter };
