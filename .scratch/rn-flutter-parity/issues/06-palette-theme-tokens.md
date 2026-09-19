Type: prototype
Status: resolved

## Question

What does the ported palette/theme token set look like as a cheap concrete artifact: Flutter `viewer_palette.dart` light tokens (`pageBackground #F3ECDF`, `surface #FFFAF1`, `surfaceContainer #EFE5D2`, `text #2E2318`, `accent #96622F`/`accentStrong #71461F`, `tableHeader #E6D9BE`, `danger #A02A22`) + dark slideshow tokens (`bg #201913`, `surface #2A2118`, `text #F7ECDC`, `accent #E0AA62`) expressed as one RN theme module replacing ad-hoc per-file `StyleSheet` hexes, with Material3 shapes/elevations approximated in RN? Produce the token file as the linked asset; human reacts to it. HITL.

## Answer

Flat `viewerTheme` module accepted (no `React.Context`); wired into all 7 components (`ManagePanel`, `MobileViewerShell`, `AppFrame`, `ViewerHeader`, `DesktopViewerShell`, `ViewerFilter`, `DesktopNotesTable`) — zero ad-hoc hexes left in `src/components/*`. Tokens: exact port of `viewer_palette.dart` (`viewerLight`/`viewerDark`/`viewerRadii`/`viewerElevation`). Verified: eslint 0 errors (2 pre-existing `no-void` warnings), tsc no new errors (pre-existing errors elsewhere untouched), `jest src/shared/viewer-core` 11/11 pass. Unblocks tickets 02–05.

## Comments

*(resolution will be appended under `## Answer` with `Status: resolved` on completion)*

- Prototype artifact (claimed, awaiting human reaction): `apps/viewer/react-native/src/theme/viewerTheme.ts` — one flat `viewerTheme` module (`light`/`dark`/`radii`/`elevation`), exact port of `viewer_palette.dart` (22/22 opaque hexes verified, 5 translucent as `rgba`), M3 radii 10/12/18/20/28/pill + elevations L0/L1/L3 via `shadowColor rgba(62,44,20,0.12)`. Thrown-away by design: not wired into any `StyleSheet` yet, no `ThemeContext`. Verified: `tsc` clean for the new file (repo has pre-existing errors elsewhere), eslint clean, `jest src/shared/viewer-core` 11/11 pass, zero ad-hoc hexes in the token file. Open questions for human: (1) accept flat module vs `React.Context` for dark slideshow? (2) wire all 7 components now as follow-up, or keep prototype unwired until slideshow/import tickets land? Status stays `claimed` — resolve only after human reacts.
