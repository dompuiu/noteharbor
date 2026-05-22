# Note Harbor

Local collection software for managing and presenting banknote archives. This monorepo contains the editable Note Harbor Editor plus a separate read-only Flutter Viewer that consumes exported archives.

## Stack

| Layer | Tech |
|---|---|
| Editor backend | Node.js (ESM), Express 5, SQLite (better-sqlite3) |
| Editor frontend | React 19, React Router 7, Vite |
| Desktop editor | Electron + electron-builder |
| Viewer | Flutter (bundled-data, read-only) |
| Scraping | Node.js + Playwright (CDP attach to an existing browser) |
| Package manager | pnpm 10 workspaces |

---

## Project Structure

```
noteharbor/
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── editor/
│   │   ├── desktop/
│   │   │   ├── package.json
│   │   │   ├── scripts/
│   │   │   │   ├── build-web.mjs
│   │   │   │   └── prepare-package.mjs
│   │   │   └── src/
│   │   │       └── main.js
│   │   ├── server/
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── index.js
│   │   │       ├── db.js
│   │   │       ├── fetchHtml.js
│   │   │       ├── operationState.js
│   │   │       ├── serverMode.js
│   │   │       ├── routes/
│   │   │       │   ├── archive.js
│   │   │       │   ├── import.js
│   │   │       │   ├── notes.js
│   │   │       │   ├── operations.js
│   │   │       │   ├── scrape.js
│   │   │       │   ├── slideshow.js
│   │   │       │   └── tags.js
│   │   │       └── scrapers/
│   │   │           ├── base.js
│   │   │           ├── pmg.js
│   │   │           └── tqg.js
│   │   └── web/
│   │       ├── package.json
│   │       ├── vite.config.js
│   │       └── src/
│   │           ├── App.jsx
│   │           ├── lib/
│   │           │   ├── api.js
│   │           │   └── appMode.js
│   │           └── components/
│   │               ├── ImportScreen.jsx
│   │               ├── NoteEditForm.jsx
│   │               ├── NotesTable.jsx
│   │               └── Slideshow.jsx
│   └── viewer/
│       └── flutter/
│           ├── pubspec.yaml
│           └── lib/
└── data/
    ├── banknotes.db
    └── images/
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Python 3.9+

### Install

```bash
pnpm install
pnpm --filter editor_server exec playwright install chromium
```

### Run the editor in development

```bash
pnpm dev
```

This starts:

- the Express API at `http://127.0.0.1:3001`
- the Vite app at `http://localhost:5173`

### Use a Windows Chrome from WSL via CDP

If you run the editor server in WSL but want to see and interact with a Windows Chrome window for bot checks, launch Chrome on Windows with remote debugging enabled and point the server at it. The scraper reads the current HTML from the already open tab whose URL matches the requested note URL.

1. Start Chrome on Windows with a dedicated profile:

```powershell
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\temp\noteharbor-cdp"
```

2. Verify the CDP endpoint is up:

```text
http://localhost:9222/json/version
```

3. Start the editor server in WSL. By default it uses `http://localhost:9222`:

```bash
pnpm dev
```

To override the CDP URL:

```bash
NOTE_HARBOR_BROWSER_CDP_URL=http://localhost:9222 pnpm dev
```

If `localhost:9222` is not reachable from WSL, use the Windows host IP instead. In many WSL setups this is the `nameserver` value from `/etc/resolv.conf`.

Workflow:

1. Open the target note page manually in the CDP browser.
2. Solve any challenge manually.
3. Trigger scrape or preview in Note Harbor.
4. The server reads the current DOM from the matching open tab.

### Build the web editor and run the server

```bash
pnpm --filter editor_web build
NOTE_HARBOR_SERVE_WEB_DIST=true pnpm --filter editor_server start
```

This serves `apps/editor/web/dist` from the Express server.

### Build the Electron editor

```bash
pnpm --filter editor_desktop build
```

The Electron package:

- builds the React UI with `VITE_DISABLE_SCRAPING=true`
- embeds the Express server and built web app
- bundles the current `data/` directory
- copies bundled data into the user-data folder when the packaged app is newer

For Windows artifacts, build on Windows:

```bash
pnpm build:editor:desktop:win
```

### Run the Flutter viewer locally

```bash
pnpm dev:viewer:flutter
```

This runs the native Flutter viewer on the default connected device/emulator.

### Build the Flutter viewer app

Build the native viewer app, then import a `.zip` archive exported from the editor on first launch:

```bash
pnpm build:viewer:flutter
```

For iOS builds:

```bash
pnpm build:viewer:flutter:ios
```

### Environment variables

Create `apps/editor/server/.env` if you want to override defaults.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Express bind host |
| `PORT` | `3001` | Express bind port |
| `NOTE_HARBOR_BROWSER_CDP_URL` | `http://localhost:9222` | CDP endpoint for the browser that already has the target page open |
| `NOTE_HARBOR_DATA_DIR` | `data` | Root data directory containing `banknotes.db` and `images/` |
| `NOTE_HARBOR_WEB_DIST_DIR` | `apps/editor/web/dist` | Static web build served by Express |
| `NOTE_HARBOR_SERVE_WEB_DIST` | `false` | Enables serving the built web app from Express |
| `NOTE_HARBOR_DISABLE_SCRAPING` | `false` | Disables scrape routes |

Client-side Vite flags must be prefixed with `VITE_`. To hide scrape UI in the web app:

```bash
VITE_DISABLE_SCRAPING=true
```

---

## Data Model

SQLite lives at `data/banknotes.db` by default and is created automatically.

### `banknotes`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `display_order` | INTEGER | Default table/slideshow ordering |
| `denomination` | TEXT | Display label |
| `issue_date` | TEXT | Free-form date text |
| `catalog_number` | TEXT | Catalog identifier |
| `grading_company` | TEXT | e.g. `PMG`, `TQG` |
| `grade` | TEXT | e.g. `65 EPQ` |
| `watermark` | TEXT | Watermark description |
| `serial` | TEXT | Serial number |
| `url` | TEXT | External grading/source URL |
| `notes` | TEXT | User notes |
| `scraped_data` | TEXT | JSON object |
| `images` | TEXT | JSON array of stored images |
| `scrape_status` | TEXT | `pending`, `done`, `failed` |
| `scrape_error` | TEXT | Last scrape error |
| `created_at` | TEXT | SQLite datetime |
| `updated_at` | TEXT | SQLite datetime |

There is no unique `(catalog_number, serial)` constraint anymore. CSV import matches existing notes by URL first, then by company/catalog/serial, then by a broader normalized identity.

### `tags` and `banknote_tags`

Tags are stored separately and linked many-to-many through `banknote_tags`.

### `slideshow_sessions`

Temporary slideshow share/session tokens are stored in `slideshow_sessions` and expired after one day.

---

## API Reference

### Health

```
GET /api/health
-> { ok: true }
```

### Notes

```
GET /api/notes
-> { notes: [NoteWithTags, ...] }

POST /api/notes
Content-Type: application/json or multipart/form-data
Body: {
  denomination,
  issue_date,
  catalog_number,
  grading_company,
  grade,
  watermark,
  serial,
  url,
  notes,
  tags: ["tag1", "tag2"],
  image_front_full?,
  image_front_thumbnail?,
  image_back_full?,
  image_back_thumbnail?
}
-> 201 { note: NoteWithTags }

POST /api/notes/reorder
Body: { ids: [number, ...] }
-> { notes: [NoteWithTags, ...] }

GET /api/notes/:id
-> { note: NoteWithTags }
-> 404 if not found

PUT /api/notes/:id
Content-Type: application/json or multipart/form-data
-> { note: NoteWithTags }

DELETE /api/notes/:id
-> { success: true }
```

`NoteWithTags` includes the banknote fields plus `tags: [{ id, name }]`, parsed `images`, and parsed `scraped_data`.

### Tags

```
GET /api/tags
-> { tags: [{ id, name }, ...] }

GET /api/tags/suggestions
-> { tags: [{ id, name }, ...] }
```

### Operations

```
GET /api/operations/status
-> {
     currentOperation: "idle" | "importing_csv" | "importing_archive" | "exporting_archive" | "clearing_data" | "scraping",
     isBusy: boolean,
     startedAt: string | null,
     details: object | null
   }
```

### CSV Import

```
POST /api/import
Content-Type: multipart/form-data
Body: file (CSV) or csv_text (plain text field)
-> { imported, updated, deleted, ignored, total, ordered }
```

Current CSV mapping is positional:

```
Denomination | Date | Catalog no | Grading company | Grade | Watermark | Serial | URL | Tags | Notes
```

Notes about CSV import:

- header rows matching `Denomination` and `Catalog no` are skipped
- rows after a line beginning with `Ignore after this line` are ignored
- empty or non-banknote rows are counted as ignored
- existing notes may be updated in place
- notes missing from the imported ordered set are deleted
- imported rows also define the resulting `display_order`

### Archive Import and Export

```
GET /api/archive/export
-> downloads noteharbor-archive-YYYY-MM-DD.zip

POST /api/archive/import
Content-Type: multipart/form-data
Body: file (.zip)
-> { success: true, currentOperation: "idle" }

DELETE /api/archive/data
-> { success: true, currentOperation: "idle" }
```

The archive contains `banknotes.db` plus `images/`. Importing an archive replaces the current data directory.

### Scraping

```
GET /api/scrape/status
-> {
     status: "idle" | "running" | "done",
     total: number,
     completed: number,
     currentNoteId: number | null,
     items: [{ noteId, label, status, error }],
     startedAt: string | null,
     finishedAt: string | null,
     error: string | null,
     currentOperation: string
   }

POST /api/scrape/start
Body: { ids: [number, ...] }
-> { message: "Scrape job started.", total }
```

Supported sources currently include PMG and TQG. Unsupported notes are marked failed.

### Slideshow Sessions

```
POST /api/slideshow
Body: { ids: [number, ...] }
-> 201 { token }

GET /api/slideshow/:token
-> { ids, created_at }
```

---

## Scraping Architecture

```
scrape.js (Node.js)
    |
    | read matching open tab over CDP
    v
fetchHtml.js (Node.js / Playwright)
    |
    | returns raw HTML
    v
scrapers/pmg.js or scrapers/tqg.js
    |
    | parse details + download images
    v
db.js updateScrapeResult(...)
```

### `src/fetchHtml.js`

Reads the current HTML from a matching open tab on a CDP-connected browser.

```bash
node -e "import('./apps/editor/server/src/fetchHtml.js').then(async ({ fetchHtml }) => console.log(await fetchHtml({ url: 'https://example.com', cdpUrl: 'http://localhost:9222', waitSeconds: 2 })))"
```

| Option | Default | Description |
|---|---|---|
| `waitSeconds` | `2` | Delay before reading the matching open tab |
| `cdpUrl` | `http://localhost:9222` in the route | CDP endpoint for the browser that already has the page open |

The helper does not open a new tab or navigate. It requires an already open tab whose URL matches the requested URL.

### Adding a new scraper

1. Add a new file in `apps/editor/server/src/scrapers/` extending `BaseScraper`.
2. Register it in `getScraperForNote()` inside `apps/editor/server/src/routes/scrape.js`.

---

## UI Screens

### Notes Table (`/`)

Primary editor screen with:

- filterable and sortable table view
- thumbnail previews
- bulk selection and bulk actions
- drag-and-drop manual reordering in the default view
- inline create/edit overlay
- slideshow launch by clicking a row

### Import and Export (`/import`)

Handles:

- CSV file import
- pasted CSV text import
- full archive export
- full archive import
- deleting current app data

### Edit (`/notes/:id/edit`)

Direct route for editing or reviewing one note outside the overlay flow.

### Viewer App

The Flutter viewer is a separate read-only application. It starts empty, imports editor archives containing `banknotes.db` plus `images/`, then shows a searchable notes table and slideshow/lightbox using imported local files.

---

## License

[MIT](./LICENSE)
