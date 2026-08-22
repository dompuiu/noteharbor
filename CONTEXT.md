# Note Harbor

Note Harbor is a local collection software for managing and presenting banknote archives. It has one authoritative store of data (the Editor) and read-only presenters that consume exported archives (the Viewers).

## Language

## Apps

**Editor**:
The authoritative app for building and maintaining a banknote collection: browsing, adding, editing, reordering, and scraping notes.
_Avoid_: Collection manager, note manager

**Viewer**:
A read-only app that presents a collection from an imported archive, on iOS or on desktop.
_Avoid_: Presentation app

**Editor app**:
The web and desktop builds of the Editor.
_Avoid_: Web editor, desktop editor (as app names)

**Viewer app**:
The iOS and desktop builds of the Viewer. Uses the same screen names as the Editor.

## Editor screens

**Table screen**:
The Editor's main screen: the collection's notes as a table, with search, filtering, reordering, and bulk actions.
_Avoid_: Notes table, list view

**Import screen**:
The Editor screen for importing and exporting collection data and managing collections.
_Avoid_: Data screen (when meaning import only)

**Note editor**:
The Editor screen for creating a new note or editing an existing one, including where the note sits in the collection's order. Has a create mode and an edit mode.
_Avoid_: Add note screen, edit note screen (as separate screens)

**Note slideshow**:
A full-screen overlay that presents one note at a time — its images, metadata, tags, and scraped details — with previous/next navigation through the collection.
_Avoid_: Detail view, presentation mode

**Image popover**:
The enlarged, single-image view opened from a note's image in the Note slideshow, navigable over that note's images.
_Avoid_: Lightbox, 2nd level slideshow

## Viewer screens

The Viewer's screens are a read-only **Table screen** and **Note slideshow** (with **Image popover**), plus an **Import screen** for loading an archive into the Viewer.

## Domain

**Note**:
One physical banknote (or banknote group) in the collection: its denomination, issue date, catalog number, grading, and associated images.
_Avoid_: Banknote, note_record, banknote row

**Collection**:
A named group of notes forming one archive. Each note belongs to exactly one collection, and a collection's notes have an order.
_Avoid_: Album, group

**Default collection**:
The collection a note lands in when none is specified and the fallback active collection; at most one collection is designated default.
_Avoid_: Primary collection

**Slideshow session**:
A shareable, token-identified list of notes the Editor has prepared for a Viewer to present.
_Avoid_: Share link, presentation

**Scrape status**:
The progress of a note's Scrape: pending, in progress, succeeded, or failed with an error.
_Avoid_: Fetch state

**Tag**:
A short label attached to notes, scoped to a collection.
_Avoid_: Label, category

**Note image**:
An image of a note's face or reverse, stored in full and thumbnail variants, either uploaded or fetched by scraping.
_Avoid_: Picture, photo, front/back (as the whole image)

**Scrape**:
Fetching a graded note's images and catalog details from its grading company (PMG, PCGS, TQG) using the note's serial number.
_Avoid_: Fetch, catalog lookup

**Archive**:
A portable bundle of a collection — its data and images — for transfer between the Editor and Viewers, or between machines. A Viewer presents one imported archive.
_Avoid_: Export, backup, dataset
