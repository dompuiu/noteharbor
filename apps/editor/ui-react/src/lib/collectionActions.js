// Deleting a collection is offered in two places — the table header's inline
// actions on the view screen and the edit mode's buttons — so the destructive
// confirmation lives here and cannot drift between them.
export function collectionDeleteConfirmation(name) {
  return {
    body: "This removes the collection and all of its notes. This cannot be undone.",
    confirmLabel: "Delete",
    title: `Delete "${name}"?`,
  };
}
