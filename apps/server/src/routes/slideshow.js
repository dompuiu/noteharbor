import { Router } from 'express';
import { createSlideshowSession, getSlideshowSession } from '../db.js';

const slideshowRouter = Router();

slideshowRouter.post('/', (request, response) => {
  try {
    const session = createSlideshowSession(request.body.ids);
    response.status(201).json({ token: session.token });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

slideshowRouter.get('/:token', (request, response) => {
  const session = getSlideshowSession(request.params.token);

  if (!session) {
    response.status(404).json({ error: 'Slideshow session not found.' });
    return;
  }

  response.json({ ids: session.ids, created_at: session.created_at });
});

export { slideshowRouter };
