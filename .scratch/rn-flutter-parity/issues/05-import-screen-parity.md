Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

What is the Import screen parity spec: first-run empty state (`Choose archive` + `Import archive` with confirm dialog, blocking spinner overlay that blocks back), collection picker + `Set as default` + `Delete active collection` + `Delete imported data`, info pills (source/generatedAt/collections/active notes), footer version — and what survives of RN's inline `ManagePanel` vs moves into this dedicated screen? HITL — resolve only with a human.

## Comments

*(resolution will be appended under `## Answer` with `Status: resolved` on completion)*

## Answer

Import screen parity spec (grilled, human accepted all defaults, Round 1):

1. **Navigation (no new dep)**: stay navigator-free. `AppShell`: `if dataset==null||collections.empty → <ImportScreen/>` else Table + header import button toggling `showImport` state rendered as full-screen `Modal`. Back blocked during import (`Modal onRequestClose={()=>{}}` while `isMutating`, ≡ Flutter `PopScope canPop:!_isImporting`); Import back button hidden on first-run and while busy (≡ Flutter `automaticallyImplyLeading` rule).
2. **ManagePanel fate**: delete `ManagePanel.tsx`; nothing survives inline. Sole entry point is Flutter-like 48px header import icon-button (gated on `canManageImportedDatasets`, owned by 02 header).
3. **Picker + import flow**: `@react-native-documents/picker` (per 01) with `.zip` filter; `Import archive` disabled until a file is picked; confirm `Alert.alert('Import archive?', 'Importing an archive replaces collections found in the archive (matched by name)...', [Cancel, Import])` verbatim; on confirm, 150ms paint delay then `controller.importArchive(path)`; blocking `Modal` + `ActivityIndicator` + `Importing archive...` + archive name driven by existing `isMutating`. Windows: manual-path text-input fallback (no picker impl).
4. **Collection controls + pills**: port verbatim — dropdown `Name (default?) (count)`, `selectCollection` instant + clears message; `Set as default` disabled if busy/active==null/already-default; `Delete active collection` danger-tonal. 4 pills: Active source (`datasetSourceLabel` / `No dataset imported`) / Dataset built (port `formatFriendlyDatasetBuiltAt` into `viewer-core`, `Not available yet` fallback) / Collections N / Notes(active) N. All themed via `viewerTheme` (per 06), `_Panel` radius-28 + `_InfoPill` styling.
5. **Destructive confirms + messages + footer**: `Alert.alert` all three with Flutter copy verbatim (Delete collection interpolates name; Delete imported data warns return-to-import-first; on success clears picked path/name). Success/error `_message` panel (`Imported X successfully.` / `Import failed: …` / `Deleted …`). Footer `Note Harbor Viewer v{app.json version}` (≡ Flutter `AppInfo.version`); RN `viewer-core …` meta stays on Table only.
