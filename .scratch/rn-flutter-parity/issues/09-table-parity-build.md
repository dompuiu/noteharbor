# 09: Table screen parity

**What to build:** The Table screen as the app's main screen: 9 sortable columns with Flutter widths and 80px rows, one-row header with logo badge plus `Notes: visible/total` pill plus 48px import button, tag-tap to filter, row-tap into the Note slideshow with filtered return, single adaptive table with horizontal scroll on narrow widths, search chrome, and themed empty row.

**Blocked by:** 08 (needs image rendering, sort-key state, picker groundwork for the import button target).

**Status:** ready-for-agent

- [ ] 9 columns (ID / Front thumbnail / Denomination / Date / Catalog / Company / Grade / Serial / Tags dynamic ≥160); Front column not sortable, all others flip on same key and reset ascending on new key with arrow on active, defaulting to collection order ascending
- [ ] Header is one row: logo badge + visible/total pill + import button gated on the manage permission; counts moved out of the shell; search syntax untouched (shared core stays canonical)
- [ ] Tag-tap sets query `tags: <name>` and scrolls horizontal to 0; row-tap opens the Note slideshow at index; return applies `tagName` to search and animated scroll-reveals `noteId` (clamped)
- [ ] One Table screen everywhere with horizontal scroll at a minimum table width; mobile card list deleted; thumbnails 96×56 with themed placeholder
- [ ] Search chrome: hint text, live-filter, `X` clear, constrained width, Collection change clears query and resets scrollers; owns the filtered-empty row; owns the `Table → Note slideshow (notes, initialIndex) → return {noteId, tagName}` contract
- [ ] Interaction tests: sort flips, pill counts, tag-tap query, row-tap index, narrow-width scroll container, empty-row copy
