# Note Harbor

Local collection software for managing and presenting banknote archives. This monorepo contains the editable Note Harbor Editor plus separate read-only viewers (Flutter, and an experimental React Native viewer) that consume exported archives.

## Stack

| Layer | Tech |
|---|---|
| Editor backend | Node.js (ESM), Express 5, SQLite (better-sqlite3) |
| Editor frontend | React, React Router, Vite |
| Desktop editor | Electron + electron-builder |
| Viewer | Flutter (bundled-data, read-only) |
| Scraping | Node.js + `playwright-core` (CDP attach to an already-running browser, no managed browser install) |
| Package manager | pnpm workspaces (version pinned via `packageManager` in `package.json`) |

---

## Workspace Layout

This is a pnpm workspace with apps under `apps/`:

- **`apps/editor/server`** — Express + SQLite backend (routes, scrapers, DB access)
- **`apps/editor/web`** — React + Vite frontend for the editor
- **`apps/editor/desktop`** — Electron shell that packages the server and web build
- **`apps/viewer/flutter`** — the read-only Flutter viewer (mature, primary viewer)
- **`apps/viewer/react-native`** — an experimental read-only viewer built with React Native, targeting iOS/Android/macOS/Windows from one codebase

Local data (SQLite DB + images) lives in `data/` by default; see [Environment variables](#environment-variables) to override the location.

For current file-level structure, browse the repo directly rather than relying on a tree snapshot here.

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (run `corepack enable`, which picks up the version pinned in `package.json`'s `packageManager` field)

### Install

```bash
pnpm install
```

No browser install step is needed: the scraper only attaches to an already-running browser over CDP (see [Use a Windows Chrome from WSL via CDP](#use-a-windows-chrome-from-wsl-via-cdp)); it never launches a Playwright-managed browser.

### Run the editor in development

```bash
pnpm dev
```

This starts:

- the Express API at `http://127.0.0.1:3001`
- the Vite app at `http://localhost:5173`

### Use a Windows Chrome from WSL via CDP

The packaged desktop app (Windows and macOS) has its own "Open Chrome" button that launches a CDP-enabled Chrome for you — see [Build the Electron editor](#build-the-electron-editor). The steps below are for running the editor server directly (e.g. `pnpm dev` in WSL), where nothing launches Chrome automatically.

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

- builds the React UI
- embeds the Express server and built web app
- bundles the current `data/` directory
- copies bundled data into the user-data folder when the packaged app is newer

On Windows and macOS, the packaged app can launch its own CDP-enabled Chrome via the "Open Chrome" button next to the URL field, so no manual CDP setup is needed for scraping there. See `NOTE_HARBOR_CHROME_PATH` in [Environment variables](#environment-variables) if Chrome isn't found at its standard install location.

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
pnpm build:viewer:flutter:windows
```

For iOS builds:

```bash
pnpm build:viewer:flutter:ios
```

### Run the React Native viewer (experimental)

An alternative read-only viewer under active development, covering iOS, Android, macOS, and Windows from one codebase. See [`apps/viewer/react-native/README.md`](apps/viewer/react-native/README.md) for native toolchain setup (Xcode/CocoaPods, Android Studio, etc.).

```bash
pnpm start:viewer:react-native
```

Then, in another terminal, run a target platform, e.g.:

```bash
pnpm dev:viewer:react-native:ios
```

Run its tests:

```bash
pnpm test:viewer:react-native
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

The desktop (Electron) app additionally reads these from its own process environment, not from `.env`:

| Variable | Default | Description |
|---|---|---|
| `NOTE_HARBOR_CHROME_PATH` | _(auto-detected)_ | Overrides the Chrome executable path used when launching the scrape browser, if it isn't found at the standard install location |

---

## Data Model

SQLite lives at `data/banknotes.db` by default and is created automatically.

### `collections`

Notes support multiple, independent collections (separate archives within one database). A single collection is marked as the default and is used whenever a request doesn't target a specific collection.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Unique, case-insensitive |
| `is_default` | INTEGER | `1` for the default collection; at most one row can have this set |
| `created_at` | TEXT | SQLite datetime |
| `updated_at` | TEXT | SQLite datetime |

### `banknotes`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `collection_id` | INTEGER | FK to `collections.id`, cascades on delete |
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

Tags are stored separately (scoped to a `collection_id`, unique per collection case-insensitively) and linked many-to-many through `banknote_tags`.

### `slideshow_sessions`

Temporary slideshow share/session tokens are stored in `slideshow_sessions` and expired after one day.

---

## API Reference

Notes, tags, and CSV import are scoped per collection. `GET/POST/PUT/DELETE /api/notes`, `/api/tags`, and `/api/import` operate on the default collection. To target a specific collection, use the `/api/collections/:collectionId/...` prefixed equivalents instead (same routes, same request/response shapes).

### Collections

```
GET /api/collections
-> { collections: [{ id, name, is_default, created_at, updated_at }, ...] }

POST /api/collections
Body: { name }
-> 201 { collection }

PUT /api/collections/:collectionId
Body: { name }
-> { collection }

PUT /api/collections/:collectionId/default
-> { collection }

DELETE /api/collections/:collectionId
-> { success: true }
```

Deleting a collection deletes its notes and tags. If it was the default, another remaining collection is promoted to default.

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

POST /api/notes/:id/move
Body: {
  target_collection_id,
  position_mode: "start" | "end" | "before" | "after",
  position_reference_id? // required for "before" / "after"
}
-> { note: NoteWithTags }
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
GET /api/archive/export?collectionIds=1,2
-> downloads noteharbor-archive-YYYY-MM-DD.zip

POST /api/archive/import
Content-Type: multipart/form-data
Body: file (.zip)
-> { success: true, currentOperation: "idle" }

DELETE /api/archive/data
-> { success: true, currentOperation: "idle" }
```

`collectionIds` is optional; omit it to export every collection. The archive contains `banknotes.db` (with its `collections` rows) plus `images/`. Importing an archive replaces the current data directory.

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

Supported sources currently include PMG, PCGS, and TQG. Unsupported notes are marked failed.

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
scrapers/pmg.js, pcgs.js, or tqg.js
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

- filterable and sortable table view, including an autocompleting tags filter and a "+N" overflow popover for rows with many tags
- thumbnail previews
- bulk selection and bulk actions
- drag-and-drop manual reordering in the default view
- inline create/edit overlay
- slideshow launch by clicking a row
- collection switcher (create, rename, delete, and set default collection)
- row-level keyboard shortcuts (`e` edit, `d` delete, `c` copy, `a` add) plus table/slideshow navigation shortcuts — press `?` for the full list

### Import and Export (`/import`)

Handles:

- CSV file import
- pasted CSV text import
- archive export, with a per-collection selector
- full archive import
- deleting current app data

### Edit (`/notes/:id/edit`)

Direct route for editing or reviewing one note outside the overlay flow.

### Viewer Apps

The Flutter viewer (`apps/viewer/flutter`) is the primary read-only viewer. It starts empty, imports editor archives containing `banknotes.db` plus `images/`, then shows a searchable notes table and slideshow/lightbox using imported local files.

The React Native viewer (`apps/viewer/react-native`) is an experimental alternative aiming for the same read-only experience across iOS, Android, macOS, and Windows from a single codebase.

---

## License

[MIT](./LICENSE)
