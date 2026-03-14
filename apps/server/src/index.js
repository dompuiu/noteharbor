import cors from 'cors';
import express from 'express';
import { IMAGES_DIR } from './db.js';
import { importRouter } from './routes/import.js';
import { notesRouter } from './routes/notes.js';
import { scrapeRouter } from './routes/scrape.js';
import { slideshowRouter } from './routes/slideshow.js';
import { tagsRouter } from './routes/tags.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/images', express.static(IMAGES_DIR));
app.use('/api/import', importRouter);
app.use('/api/notes', notesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/slideshow', slideshowRouter);

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
