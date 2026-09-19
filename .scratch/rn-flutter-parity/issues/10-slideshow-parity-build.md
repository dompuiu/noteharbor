# 10: Note slideshow parity

**What to build:** The dark full-screen Note slideshow pager over the filtered notes: per-Note card with title, grading company, front-then-back images, meta panel, `1/N` pill plus Back, tag-tap close-and-filter, keyboard/back handling, external Source URL open, and image-tap handoff to the Image popover with jump-back sync.

**Blocked by:** 08 (images, theme tokens), 09 (table open/return contract, filtered notes order).

**Status:** ready-for-agent

- [ ] Full-screen dark modal over the single app shell using dark tokens; horizontal pager over filtered notes; one shared pager/card adapted by width, no fork
- [ ] Per-slide scrollable card: centered title with `Untitled note` fallback, dark accent company, front-then-back previews with `No image`/`Missing image` fallbacks, meta panel showing only non-empty Date/Catalog/Grade/Serial/Watermark rows, Tags section only when non-empty, tappable Source URL, `No extra notes.` fallback, bottom fade hidden at scroll bottom
- [ ] Header `1/N` dark-scrim pill plus tonal Back; tag-tap closes returning `(noteId, tagName)` so the table sets `tags: <name>` and reveals the Note
- [ ] Esc closes with current Note identity; arrow keys prev/next with wrap on desktop-like only; Android hardware back and iOS swipe-dismiss route through the same close-with-Note path
- [ ] Source URL scheme-normalized and opened externally via linking; no in-app webview; image-tap opens the popover with a face target; exposes a jump-to-Note hook for the popover return
- [ ] Interaction tests: pager position, meta-panel row suppression, tag-return values, Esc/arrow/back paths, URL normalization
