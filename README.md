# Notesshow

A local collection studio for managing and displaying banknote collections. Import your collection from CSV, scrape grading company certification pages for details and images, browse your notes in a filterable table, and present them in a full-screen slideshow.

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js (ESM), Express 5, SQLite (better-sqlite3) |
| Frontend | React 19, React Router 7, Vite |
| Scraping | Python 3 + crawl4ai (browser automation), Playwright (persistent sessions) |
| Package manager | pnpm 10 (monorepo workspaces) |

---

## Project Structure

```
notesshow/
├── package.json                  # Workspace root — dev/build/start scripts
├── pnpm-workspace.yaml
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── fetch_html.py         # Python: fetches raw HTML via crawl4ai
│   │   └── src/
│   │       ├── index.js          # Express app setup, static serving
│   │       ├── db.js             # SQLite schema + all query functions
│   │       ├── routes/
│   │       │   ├── notes.js      # GET /api/notes, GET/PUT /api/notes/:id
│   │       │   ├── tags.js       # GET /api/tags/suggestions
│   │       │   ├── import.js     # POST /api/import (CSV upload)
│   │       │   └── scrape.js     # POST /api/scrape/start, /prepare-pmg, GET /status
│   │       └── scrapers/
│   │           ├── base.js       # BaseScraper — image download helpers
│   │           └── pmg.js        # PMGScraper — parses PMG cert pages
│   └── web/
│       ├── package.json
│       ├── vite.config.js        # Dev server on :5173, proxies /api → :3001
│       └── src/
│           ├── App.jsx           # Router config
│           ├── lib/api.js        # Fetch wrapper for all API calls
│           └── components/
│               ├── NotesTable.jsx
│               ├── ImportScreen.jsx
│               ├── ScrapeScreen.jsx
│               ├── NoteEditForm.jsx
│               └── Slideshow.jsx
└── data/                         # Created at runtime
    ├── banknotes.db
    └── images/scraped/           # Downloaded banknote images
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`npm install -g pnpm`)
- **Python** 3.9+

### Install

```bash
# Node dependencies
pnpm install

# Python dependencies
pip install crawl4ai beautifulsoup4 httpx
playwright install chromium
```

### Run (development)

```bash
pnpm dev
```

Starts both the Express API server (port **3001**) and the Vite dev server (port **5173**) concurrently. Open [http://localhost:5173](http://localhost:5173).

### Build & run (production)

```bash
pnpm build    # builds the React app
pnpm start    # runs Express on port 3001
```

Serve the built `apps/web/dist/` folder via your preferred static host, or extend the Express server to serve it.

### Build the Electron viewer

```bash
pnpm build:electron
```

This creates a desktop viewer build from `apps/desktop/dist-electron/`. The Electron app:

- builds the React UI with `VITE_READ_ONLY_MODE=true`
- serves the built UI and API locally through the embedded Express server
- bundles the current `data/banknotes.db` file and `data/images/` directory
- copies that bundled data into the app's user-data folder on first launch so slideshows and image browsing work without modifying the packaged files

The packaged viewer blocks import, note create/edit/delete, reorder, and scrape-start API calls server-side in addition to the existing read-only UI.

To create Windows artifacts, run the build on Windows instead of WSL/Linux:

```bash
pnpm build:electron:win
```

That produces Windows installer output from `apps/desktop/dist-electron/`, including an NSIS installer and a portable `.exe` build.

### Environment variables

Create `apps/server/.env` (loaded automatically via Node's `--env-file` flag):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Express server port |
| `PMG_BROWSER_PROFILE_DIR` | `storage/browser_profiles/pmg` | Persistent browser profile path for scraping |
| `NOTESSHOW_DATA_DIR` | `data` | Overrides where SQLite and image files are read from |
| `NOTESSHOW_WEB_DIST_DIR` | `apps/web/dist` | Overrides the static web build served by Express |
| `NOTESSHOW_READ_ONLY_MODE` | `false` | Blocks mutating API routes when enabled |

For the web app, Vite exposes client-side variables prefixed with `VITE_`. To enable table-and-slideshow-only mode, create `apps/web/.env` with:

```bash
VITE_READ_ONLY_MODE=true
```

When `VITE_READ_ONLY_MODE` is enabled, the UI hides import, add, edit, delete, scrape, reorder, row-selection controls, and the scraped-status column, and redirects `/import` plus `/notes/:id/edit` back to `/`.

---

## Database

SQLite at `data/banknotes.db`, created automatically on first run.

### `banknotes`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `denomination` | TEXT | e.g. `100 RON` |
| `issue_date` | TEXT | e.g. `2000-01-01` |
| `catalog_number` | TEXT | Catalog identifier |
| `grading_company` | TEXT | e.g. `PMG` |
| `grade` | TEXT | e.g. `65 EPQ` |
| `watermark` | TEXT | Security feature description |
| `serial` | TEXT | Banknote serial number |
| `url` | TEXT | Link to grading company cert page |
| `notes` | TEXT | Free-text user notes |
| `scraped_data` | TEXT | JSON — raw fields from scraper |
| `images` | TEXT | JSON array — local paths + source URLs |
| `scrape_status` | TEXT | `pending` / `done` / `failed` |
| `scrape_error` | TEXT | Error message if `failed` |
| `created_at` | TEXT | ISO datetime |
| `updated_at` | TEXT | ISO datetime |

Unique constraint on `(catalog_number, serial)` — prevents duplicate imports.

### `tags` / `banknote_tags`

Tags are free-text labels. The junction table `banknote_tags` links tags to notes (many-to-many, cascade-deletes).

---

## API Reference

### Health

```
GET /api/health
→ { ok: true }
```

### Notes

```
GET /api/notes
→ { notes: [ NoteWithTags, ... ] }

GET /api/notes/:id
→ { note: NoteWithTags }
→ 404 if not found

PUT /api/notes/:id
Body: { denomination, issue_date, catalog_number, grading_company, grade,
        watermark, serial, url, notes, tags: ["tag1", "tag2"] }
→ { note: NoteWithTags }
→ 400 on validation error, 404 if not found
```

`NoteWithTags` includes all columns plus `tags: [{ id, name }]`.

### Tags

```
GET /api/tags/suggestions
→ { tags: [{ id, name }, ...] }
```

### CSV Import

```
POST /api/import
Content-Type: multipart/form-data
Body: file (CSV)
→ { imported, skipped, ignored, total }
```

**CSV column order** (no header required, but header rows are auto-detected and skipped):

```
Denominatia | Data | Numar catalog | Compania grad | Grad | Marca apei | Serial | URL | Note
```

- **imported** — rows successfully inserted
- **skipped** — duplicates (unique constraint on catalog_number + serial)
- **ignored** — rows missing denomination and all identifying fields

Non-empty `Note` values are seeded as tag suggestions.

### Scraping

```
GET /api/scrape/status
→ {
    status: "idle" | "running" | "done",
    waitSeconds: number,
    total: number,
    completed: number,
    currentNoteId: number | null,
    items: [{ noteId, label, status, error }],
    startedAt, finishedAt, error,
    pmgPreparation: { status, startedAt, targetUrl, error }
  }

POST /api/scrape/prepare-pmg
Body: { url?: string }         # defaults to https://www.pmgnotes.com/certlookup/
→ { message, targetUrl, profileDir }
→ 409 if a scrape job is running

POST /api/scrape/start
Body: { ids: [number], waitSeconds: number }
→ { message, total, waitSeconds }
→ 400 if no notes with URLs, 409 if job already running
```

`/scrape/start` returns immediately; poll `/scrape/status` every few seconds to track progress.

---

## Scraping Architecture

```
 scrape.js (Node.js)
      │
      │  spawn child process
      ▼
 fetch_html.py (Python / crawl4ai)
      │  prints raw HTML to stdout
      ▼
 scrape.js receives HTML
      │
      │  getScraperForNote(note)
      ▼
 scrapers/pmg.js  ←── add new scrapers here
      │  parse(html, pageUrl) → { certNumber, details, images }
      │  downloadImages(parsed) → saves files, returns local paths
      ▼
 db.js: updateScrapeResult(...)
```

### `fetch_html.py`

A generic HTML fetcher. It knows nothing about PMG or any other site.

```bash
# Fetch a page and print HTML to stdout
python fetch_html.py <url> --wait 30 --profile-dir storage/browser_profiles/pmg

# Open a persistent browser to solve bot challenges (keeps running until closed)
python fetch_html.py --prepare <url> --profile-dir storage/browser_profiles/pmg
```

| Flag | Default | Description |
|---|---|---|
| `--wait` | `10` | Seconds to wait after page load before capturing HTML |
| `--profile-dir` | *(none)* | Persistent browser profile directory |
| `--prepare` | — | Open browser for manual bot bypass instead of fetching |

The browser always runs **non-headless** so you can interact with it if a challenge appears.

### Handling bot protection (Cloudflare)

PMG uses Cloudflare, which can block automated browsers. The recommended flow:

1. Click **"Prepare PMG browser"** in the Scrape screen (or call `POST /api/scrape/prepare-pmg`).
2. A Chrome window opens at the PMG cert lookup page.
3. Solve the Cloudflare challenge in that window.
4. The session is saved to the profile directory.
5. Start scraping — subsequent fetches reuse the saved session.

### Adding a new scraper

1. Create `apps/server/src/scrapers/mysite.js` extending `BaseScraper`:

```js
import { BaseScraper } from './base.js';

class MySiteScraper extends BaseScraper {
  parse(html, pageUrl) {
    // parse html with cheerio or whatever you prefer
    // return { certNumber, details: { ... }, images: [{ side, fullSizeUrl, thumbnailUrl }] }
  }

  async downloadImages(parsedResult) {
    const folder = this.getImageFolder(parsedResult.certNumber);
    const saved = [];
    for (const img of parsedResult.images) {
      if (img.fullSizeUrl) {
        const localPath = await this.downloadImage(img.fullSizeUrl, `${folder}/${img.side}.jpg`);
        saved.push({ type: img.side, variant: 'full', localPath, sourceUrl: img.fullSizeUrl });
      }
    }
    return saved;
  }
}

export { MySiteScraper };
```

2. Register it in `getScraperForNote()` in `scrape.js`:

```js
import { MySiteScraper } from '../scrapers/mysite.js';

function getScraperForNote(note) {
  const url = note.url?.toLowerCase() ?? '';

  if (url.includes('pmgnotes.com') || note.grading_company?.toLowerCase().includes('pmg')) {
    return new PMGScraper(note);
  }
  if (url.includes('mysite.com')) {
    return new MySiteScraper(note);
  }

  return null;  // unsupported — note will be marked failed
}
```

---

## UI Screens

### Notes Table (`/`)
Sortable, filterable view of the full collection. Click any column header to sort; type in the filter row to narrow results. Each row links to the edit form.

### Import (`/import`)
Upload a CSV file. Shows a summary of imported, skipped (duplicates), and ignored rows after upload.

### Scrape (`/scrape`)
Select notes with URLs, set the wait time (seconds), optionally prepare the browser for bot bypass, then start the scrape job. Progress is shown per-note in real time.

### Edit (`/notes/:id/edit`)
Edit all fields for a single note. The tag editor shows suggestions from previously imported notes; click a chip to add or remove a tag.

### Slideshow (`/slideshow`)
Full-screen image viewer. Pass `?ids=1,2,3` to restrict to specific notes, or show all. Navigate with arrow buttons or keyboard arrow keys.

---

## License

[MIT](./LICENSE)
