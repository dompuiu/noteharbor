# Bulk note moves travel through one scoped endpoint

Moving notes between collections has two entry points — the Table screen's selection bar and a row's actions menu — but one write path: `POST /api/collections/:id/notes/move` with `{ note_ids, target_collection_id, position_mode, position_reference_id }`, answering `{ notes }`. A single-note move from the row menu is `note_ids: [id]` against the same endpoint. The older `POST /api/collections/:id/notes/:noteId/move` stays for the Note editor's edit-mode collection change, which moves exactly one note after the update.

The bulk request is transactional and all-or-nothing: any unknown note id, invalid mode, missing reference, or a target equal to the source rejects the whole request with 400 and moves nothing. `note_ids` is taken in the order the Table screen shows it, so a multi-row move keeps the collector's relative order at the destination; the group is spliced in whole at the requested Position. The source and destination both close their gaps and renumber 1..n. Each note's tags are re-attached to the destination collection's scope.

## Considered Options

- **Loop the existing single-note endpoint in the browser.** Rejected: a failure halfway through leaves a partial move with no way to undo it, and the collector would have to work out which rows travelled.
- **A second, unscoped bulk route.** Rejected: the Table screen always knows its collection, and the unscoped mounts exist for parity with the older client, not as a new write surface.
- **Send the notes one by one from the dialog and surface a per-row error.** Rejected: the settled rule is that a bad id or position rejects the request, not the row.

## Consequences

- Both table entry points are hidden when the workspace has one collection; there is nowhere to move a note. The Note editor keeps its Collection field visible (create mode always shows it), because it also writes the note's home.
- The dialog and the Note editor share `CollectionPositionFields` (collection, Position, and the "Show … after saving/moving" checkbox), so the two surfaces cannot drift.
- Redirecting to the destination is the default in both surfaces: the destination table opens fresh (default sort, no filters or search), scrolls the moved or created note(s) into view, focuses the first one, and owns the toast (`Moved to X.`, `Moved N notes to X.`, `Note added to X.`). The first moved note is pinned to the top of the viewport (clamped near the end of the list), so a moved block is shown whole rather than with only its first row visible. Clearing the checkbox is the opt-out; the source table then drops the rows, clears the selection, and shows the same toast.
- Choosing the notes' current collection is a deliberate no-op: no request, no toast, no navigation, only the selection clears.
- "Before/after" needs a reference note in the destination; an unknown reference appends, matching the single-note route. Both surfaces disable confirm/save until a reference is picked.
- Position defaults to End in both surfaces. The editor previously opened "before the first note" when the destination had notes; that default changed deliberately.
- The single-note move route is a one-element call into the bulk row helper, so placement and tag re-attachment rules live in one place.
