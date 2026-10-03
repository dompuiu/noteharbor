import { useEffect } from "react";
import { useCollections } from "../lib/collections.jsx";
import { NamedRecordsTable } from "./NamedRecordsTable.jsx";

// The dedicated Collections screen. It reads the existing collections context
// and adapts the domain read model (`is_default` as a 0/1 flag) to the generic
// named-records table, which knows nothing about collections.
function CollectionsScreen() {
  const {
    collections,
    collectionsError,
    loadingCollections,
    createCollection,
    deleteCollection,
    refreshCollections,
    renameCollection,
    reorderCollections,
    setDefaultCollection,
  } = useCollections();

  // The provider loads once at app start, so a visit after notes were added or
  // moved would otherwise show stale note counts. Refresh on entry.
  useEffect(() => {
    refreshCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const records = collections.map((collection) => ({
    id: collection.id,
    isDefault: Number(collection.is_default) === 1,
    name: collection.name,
    noteCount: Number(collection.note_count ?? 0),
  }));

  const extraColumns = [
    {
      key: "notes",
      header: "Notes",
      className: "named-records-count-cell",
      render: (record) => record.noteCount,
    },
  ];

  return (
    <section className="screen-stack narrow-stack collections-screen">
      <div className="panel collections-panel">
        <div className="panel-heading">
          <div className="panel-heading-copy">
            <p className="eyebrow">Catalog</p>
            <h1>Collections</h1>
            <p>
              Collections group your notes. Every note belongs to one
              collection, and the default is where new notes land.
            </p>
          </div>
        </div>

        {loadingCollections ? <p className="muted">Loading collections...</p> : null}
        {collectionsError ? (
          <p className="error-text">{collectionsError}</p>
        ) : null}

        <NamedRecordsTable
          ariaLabel="Collections"
          emptyText="No collections yet. Add your first collection to get started."
          extraColumns={extraColumns}
          itemLabel="collection"
          itemLabelPlural="collections"
          loading={loadingCollections}
          onCreate={createCollection}
          onDelete={deleteCollection}
          onReorder={reorderCollections}
          onSetDefault={setDefaultCollection}
          onUpdate={renameCollection}
          records={records}
        />
      </div>
    </section>
  );
}

export { CollectionsScreen };
