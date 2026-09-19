## Destination

React Native Viewer reaches visual + behavioral parity with Flutter Viewer 1.0.5+6 on the Table screen, Note slideshow, Image popover (with Zoom view), and Import screen — same palette, columns/search/sort/filter, and image + meta presentation — ending in a spec + build-ready ticket set a builder can execute.

## Notes

- Domain: Viewer (read-only presenter of one imported archive). Canonical terms from `CONTEXT.md`: Table screen, Note slideshow, Image popover, Zoom view, Import screen, Note, Collection, Default collection, Note image, Archive. Avoid: slideshow L1, lightbox, detail view.
- Skills every session should consult: grilling + domain-modeling for HITL tickets; research skill for AFK research tickets; prototype skill for the palette ticket. Respect `CONTEXT.md` glossary; flag ADR conflicts.
- Standing preferences (locked in charting Round 1): full behavioral parity with Flutter as spec (not skin-only); Table screen everywhere adapted to narrow widths (no separate card design); exact palette tokens ported with native touch/type idioms; iOS + macOS/Windows desktop-like first, Android follows if cheap; reuse `viewer-core` + current RN adapters unless a gap forces a swap.
- Reference: `apps/viewer/flutter` (v1.0.5+6, `viewer_palette.dart`, Material3). Target: `apps/viewer/react-native` (`App.tsx` single `AppShell`, `isDesktopLike` branch).
- Plan, don't do: tickets resolve decisions, not deliverables. Research tickets may resolve AFK in charting session; HITL tickets resolve only with a human.

## Decisions so far

<!-- one line per closed ticket, gist + link; open tickets are NOT listed (query open children) -->

- [Image + data pipeline choice](issues/01-image-data-pipeline.md): one forced dep (`@react-native-documents/picker`), rest built-ins + existing adapters; keep `fflate`, system sqlite, RNFS.
- [Search-syntax audit](issues/07-search-syntax-audit.md): zero divergence — RN `search.ts` is canonical, Flutter tracks it; RN sort also candidate canonical.
- [Palette + theme tokens](issues/06-palette-theme-tokens.md): flat `viewerTheme` module, wired into all 7 components; unblocks 02–05.
- [Table parity](issues/02-table-parity.md): 9-col sortable table + header pill/badge/import + tag/row-tap + scroll-reveal + h-scroll narrow + thumbs; search chrome in, syntax out (07).
- [Image popover + Zoom view](issues/04-image-popover-parity.md): collection-wide 2N wrap + Back returns `noteId` + fit default / 1:1-gated zoom capped ~12x, built-ins only, always-dark.
- [Image popover build](issues/11-image-popover-build.md): `ImagePopover` over the slideshow's filtered notes with 2N positional counter, hand-rolled double-tap/pinch zoom, note-identity return on every exit, App-bridged via `onOpenPopover`.
- [Import screen parity](issues/05-import-screen-parity.md): navigator-free conditional + `showImport` Modal; delete `ManagePanel` for header import button; picker + verbatim confirms + `isMutating` blocking overlay; 4 pills + dropdown + ported date format; `Alert` ×3 + `app.json` footer.
- [Pipeline foundation build](issues/08-pipeline-foundation.md): picker dep + `noteImageUri`/`NoteImageView` + date-format port + blocking overlay + sort-key state; harness fixed.
- [Table parity build](issues/09-table-parity-build.md): `NotesTableScreen` 9-col + header pill/badge/import + tag/row-tap + h-scroll narrow; owns Table→slideshow contract.
- [Slideshow parity build](issues/10-slideshow-parity-build.md): dark full-screen pager + meta panel + `1/N` pill + Back/keyboard/Source URL + popover handoff with jump-back sync.
- [Import screen build](issues/12-import-screen-build.md): `ImportScreen` first-run + modal entry, picker-to-confirm-to-blocking-import, verbatim collection controls/confirms/messages, 4 pills + manifest footer; `ManagePanel` deleted.

## Not yet specified

- Navigation structure: stay single-screen `AppShell` vs introduce a stack (`Table` → `Note slideshow` → `Image popover`, plus `Import screen` push like Flutter's `MaterialApp` pushes).
- Desktop keyboard shortcuts in RN (Flutter handles Esc/←/→ in slideshow) and back behavior.
- Source-URL handling equivalent of Flutter's `url_launcher`.
- Empty / loading / error state styling parity (RN has loading/error cards in `App.tsx`; Flutter has first-run empty state + blocking import overlay + footer `v1.0.5`).
- App icon, header logo asset (`web/icons/Icon-192.png` equivalent), version footer placement.
- What, if anything, of RN `ManagePanel` survives vs moves into a dedicated Import screen.

## Out of scope

- Editor work (authoritative store, scraping, reordering, bulk actions) — different app.
- Backend/server work — Viewers are offline archive presenters.
- New features Flutter lacks — parity effort only; fresh ideas are a new effort, not this map.
