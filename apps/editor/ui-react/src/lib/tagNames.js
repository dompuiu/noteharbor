// The distinct tag names a note list carries, original spelling, sorted for a
// suggestion list. Screens that filter or edit tags share this one walk so a
// change to the note shape lands in one place.
export function collectTagNames(notes) {
  const seen = new Map();

  (notes ?? []).forEach((note) => {
    (note.tags ?? []).forEach((tag) => {
      const name = String(tag.name ?? "").trim();
      const key = name.toLowerCase();

      if (name && !seen.has(key)) {
        seen.set(key, name);
      }
    });
  });

  return Array.from(seen.values()).sort((left, right) =>
    left.localeCompare(right),
  );
}
