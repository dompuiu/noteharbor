// A library with no collections is empty, not broken: only a load that
// succeeded and returned none counts. A failed load is an error, reported
// separately. Shared so the shell and the banknote table can't disagree about
// which state they are in.
function isEmptyLibrary({ collections, collectionsError, loadingCollections }) {
  return !loadingCollections && !collectionsError && collections.length === 0;
}

export { isEmptyLibrary };
