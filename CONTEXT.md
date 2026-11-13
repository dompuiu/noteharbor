# Note Harbor

Note Harbor is a local collection software for managing and presenting banknote archives. It has one authoritative store of data (the Editor) and read-only presenters that consume exported archives (the Viewers).

## Language

## Apps

**Editor**:
The authoritative app for building and maintaining a banknote collection: browsing, adding, editing, reordering, and scraping notes.
_Avoid_: Collection manager, note manager

**Viewer**:
A read-only app that presents the collections of an imported archive, on iOS or on desktop.
_Avoid_: Presentation app

**Editor app**:
The web and desktop builds of the Editor.
_Avoid_: Web editor, desktop editor (as app names)

**Viewer app**:
The iOS and desktop builds of the Viewer. Uses the same screen names as the Editor.

## Editor screens

**Table screen**:
The Editor's main screen: the collection's notes as a table, with search, filtering, reordering, and bulk actions.
_Sidebar label_: Banknotes
_Avoid_: Notes table, list view

**All notes screen**:
The Editor's read-only union of every collection's notes in one table, with its own collection picker, filters, sorting, find, column choice, keyboard row navigation, and a slideshow over the current view. Its sidebar label is **All notes**; it is a destination beside the collections, not a mode of one. Closing that slideshow with Esc returns to the screen.
_Avoid_: Notes table (that is the Table screen), library

**Import screen**:
The Editor screen for importing and exporting collection data and managing collections.
_Avoid_: Data screen (when meaning import only)

**Note editor**:
The Editor screen for creating a new note or editing an existing one, including where the note sits in the collection's order. Has a create mode and an edit mode.
_Avoid_: Add note screen, edit note screen (as separate screens)

**Note slideshow**:
A full-screen overlay that presents one note at a time — its images, metadata, tags, and scraped details — with previous/next navigation through the current view.
_Avoid_: Detail view, presentation mode

**Image popover**:
The enlarged, single-image view opened from a note's image in the Note slideshow, navigable over that note's images. Shown in fit view by default, or in **Zoom view** on command. Its position pill names the domain — **Image 3 / 7** — so it never reads like the slideshow's note counter.
_Avoid_: Lightbox, 2nd level slideshow

**Zoom view**:
The Image popover's stepped view above the fit view, walking a ladder of 1.25×, 1.5×, 2×, 3× and 4× the fitted image, up to **1:1** — one image pixel per screen pixel; the image is pannable within the stage but never shown smaller than the fit view.
_Avoid_: Full size, 100% zoom, lightbox zoom

## Editor navigation

**Catalog**:
The Editor's management hub in the sidebar: Banknotes, Collections, and Import/Export.
_Avoid_: Manage

**Showcases**:
The Editor's presentation hub in the sidebar; it lists the workspace's Showcases and creates new ones.
_Avoid_: Portfolio

**Showcase**:
A named presentation tree the Editor author builds from notes across collections, made of Categories and Groupings.
_Avoid_: Album, gallery

**Category**:
A reusable label from the workspace's shared pool; placing it into a Showcase creates a Placement that holds that showcase's own notes and groupings.
_Avoid_: Tag, group

**Grouping**:
A standalone node inside a Showcase that nests further Groupings and notes; owned by its parent and never shared between Categories or Showcases.

**Placement**:
One occurrence of a Category inside a Showcase, owning the notes and groupings shown there.
_Avoid_: Instance, occurrence

**Cover image**:
The one note image shown for a Grouping card; the Grouping may set its own, otherwise it derives the first note beneath it. Categories have no cover image — a Category card shows its name only.
_Avoid_: Thumbnail, thumb

## Viewer screens

The Viewer's screens are a read-only **Table screen** and **Note slideshow** (with **Image popover**), plus an **Import screen** for loading an archive into the Viewer. The Table screen's title is a collection switcher; it also offers the read-only **All notes scope**, which changes which notes the table shows, never which screen is open.

**All notes scope**:
The Viewer Table screen's view of every collection's notes, chosen from the collection switcher. Unlike the Editor's **All notes screen**, it is a scope of the Table screen, not a destination of its own; the active collection stays selected underneath, so leaving the scope returns to that collection's table. Notes open grouped by collection name, and the Collection column — shown only in this scope — names each note's collection and sorts like the other columns. Below 700 logical px the card list shows the collection on every card.
_Avoid_: All notes screen (that is the Editor's), library

## Domain

**Note**:
One physical banknote (or banknote group) in the collection: its denomination, issue date, catalog number, grading, and associated images.
_Avoid_: Banknote, note_record, banknote row

**Catalog family**:
The set of notes whose catalog number shares a base number, each optionally followed by a single trailing letter: `22`, `22a`, `22b`, and `22s` are one family, while `220` and `221` are not.
_Avoid_: Variation set

**Collection**:
A named group of notes forming one archive. Each note belongs to exactly one collection, and a collection's notes have an order.
_Avoid_: Album, group

**Position**:
Where a note sits in a collection's order: the start, the end, or immediately before or after a reference note.
_Avoid_: Index, slot, rank

**Move**:
Changing a note's collection, optionally placing it at a Position in the destination. A move leaves the source collection and re-attaches the note's Tags to the destination.
_Avoid_: Transfer, copy

**Scrape status**:
The progress of a note's Scrape: pending, in progress, succeeded, or failed with an error.
_Avoid_: Fetch state

**Tag**:
A short label attached to notes, scoped to a collection.
_Avoid_: Label, category

**Note image**:
An image of a note's face or reverse, stored in full and thumbnail variants, either uploaded or fetched by scraping. The slideshow also asks the server for a cache-only preview derived from the full scan.
_Avoid_: Picture, photo, front/back (as the whole image)

**Scrape**:
Fetching a graded note's images and catalog details from its grading company (PMG, PCGS, TQG) using the note's serial number.
_Avoid_: Fetch, catalog lookup

**Archive**:
A portable bundle of one or more collections — their data and images — for transfer between the Editor and Viewers, or between machines. A Viewer presents one imported archive.
_Avoid_: Export, backup, dataset
