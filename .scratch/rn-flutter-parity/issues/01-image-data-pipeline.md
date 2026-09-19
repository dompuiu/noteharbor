Type: research
Status: resolved

## Question

What RN libraries/primitives should the parity work use to match Flutter's image + file + data pipeline: `FileImage` front/back full+thumbnail rendering, `file_picker` archive choice, `archive` zip extract, `sqlite3` read/merge of `banknotes.db`, `path_provider` app-support dir, background-isolate import with blocking overlay?

Constraints: reuse `viewer-core` + current RN `native/*DatasetAdapter` + `RNFS` + `fflate` unless a gap forces a swap. iOS + macOS/Windows first. Record what exists, what's missing (sqlite read? picker? thumb pipeline? background import?), and the recommended library for each gap with license + maintenance status.

## Answer

| Flutter capability | RN already has (reuse) | Gap | Recommended RN primitive/library + license/maintenance |
|---|---|---|---|
| `FileImage` front/back full+thumb rendering | `viewer-core` selectors (`notePreviewImage`/`noteFullImage`); `NoteImage{filePath,assetPath,sourceUrl}` plumbed via `localDataNativeDatasetAdapter.ts:52` | No `<Image>` usage in `src/components/*`; mock notes have `images:[]`; no `file://` URI or asset fallback wired | Built-in `<Image source={{uri: file://…}}>` — MIT, RN `0.81.x` active. No new dep. Map preview→thumb, full→full, fallback to bundled asset. |
| `file_picker` archive choice (`file_picker ^12.2.0`, MIT/active) | `importArchive(archivePath)` plumbed end-to-end (`useViewerController.ts:158` → `localViewerRepository.ts:19` → adapter → `FilesystemLocalArchiveImporter`) | No picker dep in `package.json`; `ManagePanel.tsx:21` hardcodes `'/mock/…zip'`; no `.zip` filter dialog | Add `@react-native-documents/picker` (rewrite of `react-native-document-picker`) — MIT, active (`12.0.2`, ~329k/wk). iOS/macOS first; Windows needs manual-path fallback (no Win impl). Only forced new dep. |
| `archive` zip extract (MIT/active, traversal guard) | `fflate ^0.8.3` (MIT, mature) + `unzipSync` + `ensureSafeArchivePath` + `writeArchiveEntries` via RNFS base64 (`localArchiveImporter.ts:92-152`) — parity on iOS/macOS | None on extract logic; Windows disabled (`resolveFileSystem()→null`) | Keep `fflate` + current importer. No swap. |
| `sqlite3` read/merge `banknotes.db` (MIT/active; replace-by-name, re-id, staged+backup rename) | Read parity via native modules: `apple/*.mm` (system `sqlite3`) + Windows `winsqlite3` (`NoteHarborImportedDatasetReader.cpp`); `mergeImportedDataset` in-memory replace-by-name + re-id | Merge is JSON-snapshot only: no `.db` write-back, no image-file copy plan, no `notes/<id>` disk rewrite, no `deleteCollection` image-dir cleanup; Windows read exists but unreachable | Keep current adapters + system `sqlite3`/`winsqlite3` (OS-maintained). No JS sqlite lib (would force swap — avoid). If true `.db` parity needed, extend existing native reader module; else document JSON divergence. |
| `path_provider` app-support dir (BSD-3, Flutter-Favorite) | `react-native-fs ^2.20.0` (MIT, stale ~4y — keep per constraint) + `DocumentDirectoryPath/noteharbor-viewer/{dataset.json,imports}` on iOS/macOS | `resolveFileSystem()` returns `null` on `windows` → in-memory mock fallback; no `LocalFolder` bridge | Keep RNFS for iOS/macOS. Windows: bridge `ApplicationData.current.localFolder` through existing reader module (platform API, no new npm dep). |
| Background-isolate import + blocking overlay (`ModalBarrier` + `PopScope canPop:!_isImporting`) | `isMutating` + button `disabled` + inline `Applying dataset change…`; native read off-main-queue | `unzipSync` + whole-file base64 on JS thread; no worker, no `Modal` barrier, no nav lock | Built-ins only — `Modal` + `ActivityIndicator` driven by existing `isMutating` + chunk/yield unzip loop. No threading lib. |

Bottom line: one forced new dep (`@react-native-documents/picker`); everything else is built-ins + existing adapters.

## Comments
