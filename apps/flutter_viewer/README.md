# Flutter Viewer

Read-only Flutter viewer for the Note Harbor collection.

## Scope

- bundled dataset only
- works without the Node server at runtime
- notes table
- slideshow level 1: note browser
- slideshow level 2: full-size image sequence across the collection

## Dataset Build

Export a `.zip` archive from the current app, then run:

```bash
pnpm build:flutter-viewer:data -- --archive /path/to/noteharbor-archive.zip
```

That writes:

- `apps/flutter_viewer/assets/data/notes.json`
- `apps/flutter_viewer/assets/data/images/...`

## Flutter Setup

This repository does not currently include a generated Flutter SDK scaffold because Flutter is not installed in this environment.

Once Flutter is available, initialize platform folders inside `apps/flutter_viewer/` if needed:

```bash
cd apps/flutter_viewer
flutter create . --platforms=ios,web
flutter pub get
flutter run -d chrome
```

Then build with the bundled dataset:

```bash
flutter build web
flutter build ios
```
