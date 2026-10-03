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
    renameCollection,
    setDefaultCollection,
  } = useCollections();

  const records = collections.map((collection) => ({
    id: collection.id,
    isDefault: Number(collection.is_default) === 1,
    name: collection.name,
  }));

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
          itemLabel="collection"
          itemLabelPlural="collections"
          loading={loadingCollections}
          onCreate={createCollection}
          onDelete={deleteCollection}
          onSetDefault={setDefaultCollection}
          onUpdate={renameCollection}
          records={records}
        />
      </div>
    </section>
  );
}

export { CollectionsScreen };
