# Showcases are one self-referential ordered node tree

A Showcase is stored as a single self-referential `showcase_nodes` table, where every row is a Category Placement, a Grouping, or a note, distinguished by `node_type` and ordered by a per-sibling `position`, rather than as split placement/contents tables or a polymorphic-parent join. This gives one uniform order per node — the "one order" the authoring canvas needs — a tree that is acyclic by construction, cascading subtree deletes, and a single recursive query for "every note beneath a node". Placement is by reference: a Category is a shared row in a global `categories` pool that each Showcase references, so renaming a label updates every Showcase while its notes and groupings stay local to each Placement.

## Considered Options

- **Split tables** (`showcase_categories` placement + `showcase_items` with two nullable parent foreign keys). Rejected: a node's parent would be polymorphic across two tables, so ordering and subtree traversal would need unions, and "one order per node" would stop being one ordered column.
- **Materialized path / closure table.** Rejected: an extra invariant (path rewriting on every move) for a tree that is small and rarely deep, with no need for ancestor queries beyond a recursive CTE.

## Consequences

- Moving a Grouping or note rewrites only its `position` (and `parent_node_id`); nothing else references its location.
- The tree is acyclic by construction, so no cycle-prevention invariant is required.
- Archive export/import must renumber and remap four reference columns (`showcase_id`, `category_id`, `note_id`, `cover_note_id`) plus the self-referential `parent_node_id`.
- Category labels follow their placements: a label with no Placement can be deleted, while placements keep `ON DELETE RESTRICT` so a used label is refused. Deleting a Placement still leaves the label in the pool, ready to be reused or deleted from the suggestion list.

## Extension: catalog shells

Supersedes the node type list above: `node_type` gains `catalog_entry`, a planned Showcase leaf carrying its own catalog metadata for one Catalog value. It is a shell, not a container: it holds no notes. Placing a shell is still one row in `showcase_nodes`, ordered by its sibling `position` and deleted with its subtree, so the tree and cascade rules are unchanged. When the collector picks a library note, the server rewrites that same row to `node_type = 'note'` with a `note_id`, preserving its parent and position; replacing a shell never disturbs the surrounding order.

An older build stored zero-or-more specimens per entry in `showcase_catalog_notes`. Those rows are legacy: schema initialization collapses each entry with specimens into a note node using its primary (or first) specimen, then drops the extra links. Archive export/import still understands the join so old archives load, but the editor no longer authors or displays specimen sets.
