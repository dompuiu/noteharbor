# Note Harbor Viewer

Read-only Flutter app for the Note Harbor Viewer.

## Scope

- native import of editor archives (`banknotes.db` + `images/`)
- works without the Node server at runtime
- notes table
- slideshow level 1: note browser
- slideshow level 2: full-size image sequence across the collection

## Runtime Data Flow

Build the native viewer app, then on first launch import a `.zip` archive exported from the editor.

The archive must contain:

- `banknotes.db`
- `images/`

## Window Geometry

On desktop (Windows and macOS) the viewer remembers the window's position and
size and restores them on the next launch. The first launch opens an
iPhone-sized portrait window (`393x852`) at `(10, 10)`, and the window cannot be
shrunk below `320x480`.

The state is a small JSON file inside the shared application-support folder,
next to the imported dataset:

```
<application support>/noteharbor_viewer/window_state.json
```

On Windows that resolves to something like
`%APPDATA%\com.noteHarbor.viewerFlutter\Note Harbor Viewer\noteharbor_viewer\window_state.json`.

There is no in-app reset control: if a window ever opens somewhere unhelpful,
delete `window_state.json` and the next launch falls back to the defaults.
Saved geometry that points at a disconnected monitor is also repaired
automatically on load.

On Windows, closing while maximized reopens the window maximized (un-maximizing
returns to the remembered size). On macOS the maximized/fullscreen state is not
remembered; the last normal position and size always win.

## Flutter Setup

This repository does not currently include a generated Flutter SDK scaffold because Flutter is not installed in this environment.

Once Flutter is available, initialize platform folders inside `apps/viewer/flutter/` if needed:

```bash
cd apps/viewer/flutter
flutter create . --platforms=ios,android,macos,windows,linux
flutter pub get
flutter run
```

Then build the native viewer app:

```bash
flutter build ios
flutter build apk
```
