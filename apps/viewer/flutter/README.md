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
