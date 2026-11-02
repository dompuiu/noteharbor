# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a banknote collector who builds and maintains their own archive in the Editor: cataloguing notes, attaching images, ordering a collection, and arranging Showcases for presentation. They work alone, on their own machine, usually with many notes in front of them and a grading-company page open alongside.

A second audience consumes the result read-only: people who receive an exported archive and browse it in the Viewer apps (iOS or desktop). They do not edit, and they see the same screen names and terminology as the Editor.

## Product Purpose

Note Harbor is local collection software for managing and presenting banknote archives. It keeps one authoritative store of data in the Editor and serves it to read-only Viewers through exported archives. Success means a collector can get a graded note from an external grading page into a well-ordered, richly imaged archive without retyping, and can later present that archive as a curated Showcase.

## Positioning

Scrape-first cataloguing combined with curated Showcases. Note data and images are pulled from grading-company pages (PMG, PCGS, TQG) through a browser the user already has open, rather than uploaded by hand, and notes can then be arranged into a Showcase tree of Categories, Groupings, and notes built for presentation. A spreadsheet or generic collection tracker can hold the fields, but not this scrape-to-archive-to-showcase path.

## Operating Context

- The Editor is authoritative: it browses, adds, edits, reorders, and scrapes notes. Viewers only present an imported archive.
- Collection data lives locally in `data/` by default: a SQLite database (`banknotes.db`) plus an `images/` folder.
- Scraping needs a CDP-attached browser that already has the target grading page open. In WSL development this is commonly Windows Chrome reached over `http://localhost:9222`; the packaged desktop app launches its own CDP-enabled Chrome.
- Work arrives as CSV lists (positional columns) and as archive bundles (`.zip` of database plus images) moved between the Editor, Viewers, and machines.
- The Table screen is the daily workspace: filtering, sorting, manual reordering, bulk actions, row-level and navigation keyboard shortcuts, and a slideshow launched from a row.
- Showcases are authored one level at a time, in an edit mode that mirrors the read-only view.

## Capabilities and Constraints

- Screens: Table screen, Import screen, Note editor (create and edit modes), Note slideshow, Image popover with Zoom view, and Showcases (view and edit).
- Collections partition notes; each note belongs to exactly one collection and collections have their own order and default.
- Tags are collection-scoped; Categories are a workspace-wide shared label pool reused across Showcases; Groupings are owned by their parent.
- Fixed constraints: local-only with no cloud, accounts, sync, or hosted service; the Editor is the only writer; everything works offline except scraping; the product ships as a web app, a Tauri desktop app, and a separate native Flutter viewer.
- Terminology is binding; see `CONTEXT.md` at the repo root for the terms future work must use and the ones to avoid.
- Undecided: no accessibility standard has been confirmed.

## Brand Commitments

- Product name: Note Harbor.
- Voice and vocabulary follow `CONTEXT.md`: Note (not banknote record), Collection, Catalog family, Showcase, Category, Grouping, Placement, Note image, Scrape, Archive. The `_Avoid_` terms are binding exclusions, not suggestions.
- No logo, palette, typography, or visual identity is confirmed yet.

## Evidence on Hand

- `README.md`: stack, workspace layout, data model, API reference, CSV mapping, scraping architecture, and UI screen descriptions.
- `CONTEXT.md`: the domain glossary and screen map.
- `docs/adr/0001-showcase-node-tree.md`, `docs/adr/0002-table-filter-rail.md`: structural decisions already made.
- `.scratch/table-filter-rail/`: in-progress spec work for the Table screen's filtering.
- The React app and its tests in `apps/editor/ui-react/src`: the incumbent implementation and behavior.
- Absent and not to be fabricated: customer names, testimonials, benchmarks, pricing, or deployment claims beyond the MIT license.

## Product Principles

1. One authority, many presentations: every mutation belongs to the Editor, and Viewers stay read-only consumers of an archive.
2. Local first: the archive is the user's files on their machine; no feature may depend on a service being reachable.
3. Capture, don't retype: scraping and import should turn existing external data into complete notes, and the UI should make that path obvious.
4. Order is content: collection order, showcase hierarchy, and note position are real user-authored data, not incidental layout.
5. Dense but fluent: the Table screen is a working surface for large archives, so scanning, keyboard flow, and bulk actions outrank decoration.
