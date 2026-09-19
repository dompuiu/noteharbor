Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

What is the Table screen parity spec: 9 columns (ID/Front-thumb/Denomination/Date/Catalog/Company/Grade/Serial/Tags with dynamic tag width), sortable scrollable table, `visible/total` pill + header badge + import button, tag-tap-to-filter, row-tap → Note slideshow with tag-result filter return, scroll-reveal by `noteId`, search syntax (`denom:/date:/cat:/catalog:/company:/grading:/grade:/tags:/tag:`, `,` multi-value, `!` negation, denom normalization), adapted to narrow widths instead of RN's current 4-col table / placeholder cards?

Needs: pipeline decision (ticket 01) + palette tokens (ticket 06) first. HITL — resolve only in live exchange with a human; agent must not answer for the human.

## Comments

*(resolution will be appended under `## Answer` with `Status: resolved` on completion)*

## Answer

Table screen parity spec (grilled, human accepted all defaults, Rounds 1–2):

1. **Columns**: Flutter's 9 (`ID 90 / Front 120 / Denomination 190 / Date 120 / Catalog 130 / Company 120 / Grade 110 / Serial 140 / Tags dynamic ≥160`), 80px rows. Replaces RN 4-col (`DesktopNotesTable.tsx`) — split `Title` back out, add Front + ID.
2. **Sort**: clickable headers (all but Front); same key flips dir, new key resets asc; arrow on active; default `displayOrder` asc. Wire existing `sortViewerNotes` to new `sortKey/ascending` state (today hardcoded `useViewerController.ts:141-144`).
3. **Header**: one row — logo badge (`Note Harbor`) + `Notes: visible/total` pill + 48px import button gated on `canManageImportedDatasets`. Counts move out of `DesktopViewerShell:39-42`; `ManagePanel` import controls collapse into the button (detail in 05).
4. **Interactions**: tag-tap → query `tags: X` + h-scroll to 0; row-tap → Note slideshow at index; return applies `tagName` to search + scroll-reveals `noteId` (clamped, animated).
5. **Narrow widths**: one Table screen everywhere, horizontal scroll at `minTableWidth`; delete `MobileViewerShell` card list.
6. **Thumbs**: built-in `<Image>` `file://` URI (preview→thumb per 01), 96×56, themed placeholder on null/error.
7. **Navigation**: Table ticket owns `Table → Note slideshow (notes, initialIndex) → return {noteId, tagName}` contract; 03 owns slideshow internals. Platform-default stack.
8. **Search chrome**: hint text, live-filter, `X` clear, `maxWidth: 420`, collection change clears query + jumps scrollers to 0. Syntax untouched (canonical per 07).
9. **States**: Table owns filtered-empty row (`No notes match...`, themed); first-run/overlay/footer to 05.
10. **Tags width**: min 160, grow to widest chips + padding, recompute on data change; builder picks measuring API.

Search syntax excluded (07: zero divergence). Palette tokens assumed (06). Nav-stack choice may deserve an ADR when built.
