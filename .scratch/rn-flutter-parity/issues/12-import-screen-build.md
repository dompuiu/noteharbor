# 12: Import screen parity

**What to build:** The dedicated Import screen replacing the inline manage panel: first-run conditional plus modal overlay entry from the table header, picker-to-confirm-to-blocking-import flow, Collection controls with verbatim confirms, four info pills with ported date format, outcome messages, and manifest version footer.

**Blocked by:** 08 (picker, blocking overlay, date-format port), 09 (header import button entry point).

**Status:** resolved

- [x] Navigator-free: no dataset or no Collections renders the Import screen; otherwise table plus header import button toggling a full-screen modal; back blocked while mutating; import back button hidden on first-run and while busy
- [x] Inline manage panel deleted; sole entry is the header import button from the Table screen ticket
- [x] Picker with `.zip` filter; import action disabled until picked; verbatim Archive-replace confirm; short paint delay then controller import; blocking modal with spinner and archive name driven by the mutating flag; Windows manual-path fallback
- [x] Collection controls ported verbatim: dropdown `Name (default?) (count)` with instant select clearing messages, `Set as default` disabled states, danger-tonal delete; four pills (Active source / Dataset built / Collections N / Notes(active) N) themed with sheet and pill styling
- [x] Three destructive confirms plus success/error message panel copy verbatim (`Imported X successfully.` / `Import failed: ...` / `Deleted ...`); success clears picked path/name; footer version from the app manifest
- [x] Interaction tests: first-run vs modal entry, disabled-until-picked, confirm copy, back-blocked-while-mutating, pill values, delete/default flows

## Answer

Built on `main`, tests-first at the component/contract seam
(`ImportScreen.test.tsx`, 17 tests):

- `src/components/ImportScreen.tsx`: navigator-free first-run vs modal (`isFirstRun`, `onClose` back hidden first-run + while busy); picker via `pickArchiveFile` (`.zip` filter, cancel → null), import disabled until picked, verbatim Archive-replace `Alert`, 150ms paint delay then `controller.importArchive`, success clears pick (`Imported X successfully.` / `Import failed: ...`); Windows manual-path fallback; collection option list with verbatim `Name (default?) (count)` labels + instant select clearing message; `Set as default` disabled states; danger-tonal deletes with verbatim confirms (`Deleted ...` / imported-data copy); 4 pills (Active source / Dataset built via core `formatFriendlyDatasetBuiltAt` + `Not available yet` fallback / Collections N / Notes(active) N); footer `Note Harbor Viewer v{app.json version}`; all themed via `viewerLight` + `viewerRadii`.
- `App.tsx`: first-run conditional + header-import-button modal (`showImport`), back blocked while `isMutating` (`onRequestClose` noop); `ManagePanel` deleted, no references remain.
- `ImportBlockingOverlay` with archive name shown during the in-flight import.

Verified: jest 12 suites / 110 tests pass (ImportScreen 17/17).

## Comments

## Answer
