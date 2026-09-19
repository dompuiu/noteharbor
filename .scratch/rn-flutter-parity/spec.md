Status: ready-for-agent

## Problem Statement

Viewers who open an imported Archive in the React Native Viewer see a different app than the Flutter Viewer (v1.0.5+6): a 4-column Table screen with placeholder cards on narrow widths, no Note slideshow, no Image popover with Zoom view, an inline manage panel instead of an Import screen, ad-hoc colors, and no front/back Note image rendering. The Flutter Viewer is the visual + behavioral reference; the React Native Viewer must reach parity with it.

## Solution

Bring the React Native Viewer to full behavioral parity with the Flutter Viewer on four surfaces — Table screen, Note slideshow, Image popover (with Zoom view), Import screen — reusing the shared viewer-core plus current native adapters, porting the exact palette tokens, wiring built-in image/picker/modal primitives, and deleting the divergent inline manage panel. No new navigation library, no new gesture/animation/image library; one forced picker dependency only.

## User Stories

1. As a Viewer user, I want the Table screen to show ID, front thumbnail, Denomination, Date, Catalog, Company, Grade, Serial, and Tags columns, so that I see the same fields as Flutter.
2. As a Viewer user, I want to sort the Table screen by clicking any header except Front, so that I can order notes the way Flutter does.
3. As a Viewer user, I want the active sort header to show an arrow and a sane default (collection order, ascending), so that I know how the table is ordered.
4. As a Viewer user, I want the Table screen header to show a logo badge, a `Notes: visible/total` pill, and a 48px import button, so that counts and import entry match Flutter.
5. As a Viewer user, I want tapping a Tag chip in the table to filter to `tags: <name>` and scroll to the start, so that I can narrow by Tag.
6. As a Viewer user, I want tapping a table row to open the Note slideshow at that Note, so that I can read one Note at a time.
7. As a Viewer user, I want returning from the Note slideshow with a Tag to apply that Tag filter and reveal the originating Note, so that cross-screen navigation round-trips.
8. As a Viewer user, I want one Table screen everywhere with horizontal scroll on narrow widths, so that I get a table on phone widths instead of a separate card list.
9. As a Viewer user, I want front thumbnails (96×56) with a themed placeholder on missing/error images, so that image gaps look intentional.
10. As a Viewer user, I want search chrome with hint text, live filtering, an `X` clear affordance, and query reset on Collection change, so that search feels like Flutter.
11. As a Viewer user, I want the full search syntax (`denom:/date:/cat:/catalog:/company:/grading:/grade:/tags:/tag:`, `,` multi-value, `!` negation, denomination normalization) to keep working unchanged, so that parity does not regress search.
12. As a Viewer user, I want a themed `No notes match...` row when the filter is empty, so that empty results are explicit.
13. As a Viewer user, I want the Note slideshow as a full-screen dark overlay paging over the filtered notes, so that presentation matches Flutter's dark slideshow.
14. As a Viewer user, I want each slide to show title (`denomination - catalogNumber`, `Untitled note` fallback), grading company accent, front then back images, and a meta panel, so that I see the same Note presentation.
15. As a Viewer user, I want the meta panel to show only non-empty Date/Catalog/Grade/Serial/Watermark rows, Tags only when non-empty, tappable Source URL, and `No extra notes.` fallback, so that sparse Notes stay clean.
16. As a Viewer user, I want a `1/N` pill and tonal Back button on the slideshow, so that position and exit are always visible.
17. As a Viewer user, I want tapping a Tag in the slideshow to close and filter the Table screen to that Tag while revealing the Note, so that Tags navigate consistently.
18. As a Viewer user, I want Esc to close the slideshow, arrow keys to page with wrap-around on desktop-like targets, and hardware back / swipe-dismiss to close with the current Note, so that keyboard and back behavior match Flutter.
19. As a Viewer user, I want Source URLs to open externally with scheme normalization, so that bare domains still open.
20. As a Viewer user, I want tapping a slideshow image to open the Image popover at that face, and closing the popover to jump the slideshow to the returned Note, so that the two overlays stay in sync.
21. As a Viewer user, I want the Image popover to page the whole Collection interleaved front/back (2N, wrap-around) with a `k / 2N` counter, so that I can walk every Note image.
22. As a Viewer user, I want missing images to stay as positional `No image` pages, so that the counter never shifts.
23. As a Viewer user, I want fit-by-default presentation and Zoom view at 1:1 only when the natural size exceeds space (pannable, never smaller than fit, capped ~12x, reset on page change), so that zoom matches Flutter.
24. As a Viewer user, I want double-tap to toggle zoom at the tap point and pinch to zoom, with the pager disabled while zoomed or multi-touch, so that gestures do not fight paging.
25. As a Viewer user, I want Back (plus Android back / desktop Esc, arrows to move) to close the popover and sync the slideshow, so that exit always lands on the right Note.
26. As a Viewer user, I want a per-image spinner while resolving and a `Couldn't load image` state I can swipe past, so that slow or broken images do not trap me.
27. As a Viewer user, I want accessible labels on popover prev/next/Back/zoom, so that assistive tech announces position and actions.
28. As a Viewer user, I want a first-run Import screen with archive choice plus disabled-until-picked import action and verbatim confirm, so that first import is guided and explicit.
29. As a Viewer user, I want import to show a blocking overlay that blocks back navigation while applying, so that I cannot corrupt an in-flight import.
30. As a Viewer user, I want Collection controls (dropdown `Name (default?) (count)`, instant select, `Set as default`, danger-tonal `Delete active collection`, `Delete imported data`) with verbatim destructive confirms, so that Collection management matches Flutter.
31. As a Viewer user, I want four info pills (Active source / Dataset built / Collections N / Notes(active) N) with the ported date format, so that Archive provenance is visible.
32. As a Viewer user, I want success/error message panels (`Imported X successfully.` / `Import failed: ...` / `Deleted ...`) and a version footer from the app manifest, so that outcomes and version are explicit.
33. As a Viewer user, I want the same light page palette and dark slideshow palette as Flutter across all components with zero ad-hoc hexes, so that the app looks like the same product.
34. As a Viewer user on iOS or desktop-like targets, I want the primary supported experience, with Android following where cheap, so that the main targets are solid first.
35. As a Viewer user on Windows without a native picker, I want a manual-path fallback for archive choice, so that import still works.

## Implementation Decisions

- Scope is Viewer parity only: Table screen, Note slideshow, Image popover + Zoom view, Import screen. Flutter v1.0.5+6 (`viewer_palette.dart`, Material3) is the visual + behavioral reference; React Native target is the single-`AppShell` app with an `isDesktopLike` branch.
- Pipeline (from decision 01): one forced new dependency (`@react-native-documents/picker`, MIT/active) for Archive choice with `.zip` filter; everything else is built-ins plus existing adapters. Keep `fflate` + current archive importer for zip extract, system sqlite / winsqlite3 behind the existing native reader for reads, RNFS paths on iOS/macOS, built-in `<Image source={{uri: file://…}}>` mapping preview→thumbnail and full→full with bundled-asset fallback. No JS sqlite library. Windows file-system gap is bridged through the existing native reader module (platform API), not a new npm dependency.
- Import threading: no threading library. Yield/chunk the unzip loop off the critical paint and drive a built-in `Modal` + `ActivityIndicator` blocking overlay from the existing `isMutating` flag; block back while busy (equivalent of Flutter's `PopScope canPop:!_isImporting`).
- Theme (from decision 06): single flat theme module — no theme context. Exact port of the Flutter palette: a light set (page/surface/container/table-header/text/accent/danger/tag tokens), a dark slideshow set (background/surface/raised/text/accent/scrim/light-chip reuse), Material3 radii (10/12/18/20/28/pill) and elevations (L0/L1/L3 via the warm shadow color). Already wired into all components; new screens must consume only these tokens. Shape (decision-rich trim from the prototype):
  `theme = { light: {pageBackground, surface, surfaceContainer, border*, tableHeader, text*, accent*, danger*, tag*}, dark: {background, surface, raised, border, text, muted, accent, scrim, tag*}, radii: {xs,sm,md,lg,xl,pill}, elevation: {level0, level1, level3} }`
- Search is frozen (from decision 07): React Native `search.ts` is canonical; Flutter tracks it. No syntax changes. Sort canonical is React Native's locale-aware numeric sort.
- Table screen (from decision 02): 9 columns with the Flutter widths (ID 90 / Front 120 / Denomination 190 / Date 120 / Catalog 130 / Company 120 / Grade 110 / Serial 140 / Tags dynamic ≥160), 80px rows; clickable headers (all but Front; same key flips, new key resets ascending, arrow on active, default collection order ascending) wired to the existing sort helper via new sort-key/ascending state (today hardcoded). Header is one row: logo badge + `Notes: visible/total` pill + 48px import button gated on the manage permission. Tag-tap sets query `tags: X` and scrolls horizontal to 0; row-tap opens the Note slideshow at index; return applies `tagName` to search and animated scroll-reveals `noteId` (clamped). One Table screen everywhere with horizontal scroll at a minimum table width; delete the mobile card list. Search chrome: hint, live-filter, `X` clear, max width 420, reset + scrollers-to-0 on Collection change. Filtered-empty row owned by the table; first-run/overlay/footer owned by the Import screen. Tags column min 160 growing to widest chips, recomputed on data change. Table owns the `Table → Note slideshow (notes, initialIndex) → return {noteId, tagName}` contract; platform-default stack expectations.
- Note slideshow (from decision 03): full-screen dark `Modal` over the single `AppShell` using dark tokens; horizontal pager over filtered notes; no stack navigator. Slideshow owns pager + meta panel + open/return contract; image-tap opens the Image popover with a face target and the popover returns a Note identity the slideshow jumps to. Per-slide scrollable card: centered title, dark accent company, front-then-back previews (aspect ~1.65, contain, `No image`/`Missing image` fallbacks), meta panel on the dark raised surface with non-empty rows only, wrapping Tag chips, tappable Source URL, always-present notes text, bottom fade hidden at scroll bottom. Header: `1/N` dark-scrim pill + tonal Back. Tag-tap closes returning `(noteId, tagName)`; table sets `tags: <name>` (canonical, fixing Flutter's raw-name inconsistency) plus reveal. Keyboard/back: Esc closes with current `noteId`; arrows prev/next with wrap on desktop-like only; Android hardware back and iOS swipe-dismiss route through the same close-with-`noteId`. Source URL is scheme-normalized and opened externally via linking; no in-app webview. One shared pager/card adapted by width, no fork.
- Image popover + Zoom view (from decision 04): behaviorally matches Flutter's lightbox. Collection-wide front/back interleaved sequence (2N, wrap-around); nulls kept as placeholder pages so the counter stays positional. Header: `k / 2N` dark-scrim pill + note title + Back; always-dark regardless of app theme. Fit-by-default (contain); Zoom view is 1:1 only when natural size exceeds space, pannable, never smaller than fit, capped ~12x (larger only if 1:1 demands it), reset on page change. Gestures built-ins only: modal + horizontal paging + nested zoom with hand-rolled double-tap toggle anchored at tap; pager disabled while zoomed/multi-touch. Escalate to gesture/pager libraries only if the builder demonstrates focal pinch is unachievable with built-ins. Close returns current `noteId` for slideshow sync on all exits (button, Android back, desktop Esc); arrows navigate on desktop-like, swipe elsewhere. Per-image spinner; `Couldn't load image` + swipe-on, no retry in v1. Title-only header (no source-URL tap; that belongs to the slideshow). Slideshow must expose a jump-to-Note hook for the return sync.
- Import screen (from decision 05): navigator-free. `AppShell`: when no dataset or no Collections, render the Import screen; otherwise table plus header import button toggling a full-screen modal import overlay. Back blocked while `isMutating`; import back button hidden on first-run and while busy (Flutter `automaticallyImplyLeading` equivalent). Delete the inline manage panel; sole entry is the header import icon-button. Picker with `.zip` filter; import action disabled until picked; verbatim Archive-replace confirm; short paint delay then controller import; blocking modal driven by `isMutating`. Windows: manual-path text-input fallback. Controls ported verbatim: dropdown `Name (default?) (count)` with instant select clearing messages, `Set as default` disabled states, danger-tonal delete, four pills (Active source / Dataset built via a `formatFriendlyDatasetBuiltAt` helper ported into viewer-core / Collections N / Notes(active) N), all themed with sheet radius 28 and pill styling. Three destructive confirms use `Alert` with Flutter copy verbatim; success clears picked path/name; success/error message panel; footer version from the app manifest (viewer-core meta stays on the table only).
- Standing preferences locked during wayfinding and carried into build: full behavioral parity (not skin-only); one adaptive Table screen (no separate card design); exact palette tokens with native touch/type idioms; iOS + macOS/Windows desktop-like first, Android follows where cheap; reuse viewer-core + current adapters unless a gap forces a swap.
- Navigation-stack choice (single-shell + modals vs. introducing a stack) may deserve an ADR at build time if the import/table return contracts strain the modal approach.

## Testing Decisions

- What makes a good test here: external behavior at the seam, not implementation details. Assert what the user sees/does (columns, sort order, pill counts, query strings, pager position, counter text, confirm copy, blocking overlay while mutating) rather than style objects or internal state names.
- Seams (highest possible, existing first; proposed: two seams, no new ones unless the builder proves a gap):
  1. Shared core pure functions (search/filter/sort/selectors/dataset-built formatting/image variant pick) — the highest seam; covers syntax freeze, sort canonical, pills, dropdown labels, counter math.
  2. Viewer controller hook + modal open/return contracts (`query`, filtered notes, sort key/dir, `isMutating`, `Table → slideshow → popover → return {noteId, tagName}`, import/delete/default flows) exercised with repository fakes — covers cross-screen behavior without rendering pixels.
- Component rendering is verified through these contracts plus thin interaction tests over the existing React Native test renderer (tap row → slideshow at index; tap tag → `tags:` query; popover close → slideshow jump; import confirm → repository call; back blocked while mutating). No new harness; no screenshot-golden tests in v1.
- Prior art: shared-core unit suite (`viewer-core` index tests: tags/catalog/denom, negation, multi-value, date-comma, thousands), controller hook tests, archive-importer and native-adapter tests, eslint + typecheck clean for new modules. New work follows the same layout: core pure-function tests first, then hook/contract tests, then thin component interaction tests.
- Gaps to lock down with regression tests: sort-key/dir wiring (today hardcoded), scroll-reveal clamping, zoom-reset on page change, pager-disabled-while-zoomed, Windows manual-path fallback, verbatim confirm/message/footer copy.

## Out of Scope

- Editor work (authoritative store, scraping, reordering, bulk actions) — different app.
- Backend/server work — Viewers are offline Archive presenters.
- New features Flutter lacks — parity effort only; fresh ideas are a separate effort.
- Full Windows picker implementation (manual-path fallback instead); true `.db` write-back / image-file copy plan / image-dir cleanup on delete (JSON-snapshot merge stands; document divergence rather than extending the native module in this effort).
- Gesture/pager/reanimated libraries, in-app webview for Source URLs, retry on image failure, screenshot-golden or visual-diff harness — escalate only with builder evidence.
- App icon / store assets beyond the version footer and header logo badge placement already specified.

## Further Notes

- References: Flutter Viewer v1.0.5+6, `viewer_palette.dart` (Material3), Table/Slideshow/Lightbox/Import screens; React Native single-`AppShell` with `isDesktopLike` branch; `viewer-core` + current adapters + RNFS + `fflate` unless a gap forces a swap.
- Map deltas to reconcile at build: the wayfinding map's "Not yet specified" list predates resolutions 02–05 (navigation, keyboard/back, source-URL, empty/loading/error, ManagePanel fate) — those are decided above; treat this spec as superseding that section.
- Build order suggestion (for `/to-tickets`): pipeline dep + date-format port → table → slideshow → popover → import; palette/search are done and unblock all.
- Prototype artifact already folded in: flat theme module (exact port, wired into all components). Keep it flat; add a theme context only when a dark React Native screen actually ships and proves the need.

## Comments
