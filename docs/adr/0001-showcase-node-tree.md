# Showcases are one self-referential ordered node tree

A Showcase is stored as a single self-referential `showcase_nodes` table, where every row is a Category Placement, a Grouping, or a note, distinguished by `node_type` and ordered by a per-sibling `position`, rather than as split placement/contents tables or a polymorphic-parent join. This gives one uniform order per node — the "one order" the authoring canvas needs — a tree that is acyclic by construction, cascading subtree deletes, and a single recursive query for "every note beneath a node". Placement is by reference: a Category is a shared row in a global `categories` pool that each Showcase references, so renaming a label updates every Showcase while its notes and groupings stay local to each Placement.

## Considered Options

- **Split tables** (`showcase_categories` placement + `showcase_items` with two nullable parent foreign keys). Rejected: a node's parent would be polymorphic across two tables, so ordering and subtree traversal would need unions, and "one order per node" would stop being one ordered column.
- **Materialized path / closure table.** Rejected: an extra invariant (path rewriting on every move) for a tree that is small and rarely deep, with no need for ancestor queries beyond a recursive CTE.

## Consequences

- Moving a Grouping or note rewrites only its `position` (and `parent_node_id`); nothing else references its location.
- The tree is acyclic by construction, so no cycle-prevention invariant is required.
  Superseded in part by ADR-0006: once a node can be reparented, the move
  endpoint owns the cycle check.
- Archive export/import must renumber and remap four reference columns (`showcase_id`, `category_id`, `note_id`, `cover_note_id`) plus the self-referential `parent_node_id`.
- Category labels follow their placements: a label with no Placement can be deleted, while placements keep `ON DELETE RESTRICT` so a used label is refused. Deleting a Placement still leaves the label in the pool, ready to be reused or deleted from the suggestion list.

## Extension: catalog shells

Supersedes the node type list above: `node_type` gains `catalog_entry`, a planned Showcase leaf carrying its own catalog metadata for one Catalog value. It is a shell, not a container: it holds no notes. Placing a shell is still one row in `showcase_nodes`, ordered by its sibling `position` and deleted with its subtree, so the tree and cascade rules are unchanged. When the collector picks a library note, the server rewrites that same row to `node_type = 'note'` with a `note_id`, preserving its parent and position; replacing a shell never disturbs the surrounding order.

An older build let one entry hold zero-or-more specimens through the `showcase_catalog_notes` join, with one marked primary. That model is retired: the join table, its triggers, the `PUT /api/nodes/:id/notes` route, and the specimen fields on the wire are gone; `note_ids` on entry creation is no longer read. Schema initialization drops the table outright, so a database from that build keeps its entries but not their specimen links, and archive import no longer reads the join.

## Extension: re-binding a Category Placement to another label

Supersedes the clause above that renaming a label updates every Showcase. `PUT /api/nodes/:id` with a `name` now sets the label on that one Category Placement: a name already in the pool adopts that label, and a new name creates one. Other Showcases keep the label they place, so the edit is local to the Showcase being edited. When the Placement was the last user of the label it left behind, that label is pruned in the same transaction; a label still placed elsewhere stays in the pool. A label the Showcase already places is refused, since each Showcase places a label once. `PUT /api/categories/:id` remains the way to rename the shared label everywhere it is placed.

## Extension: replacing a note card's note

A note card's `note_id` is mutable: `PUT /api/nodes/:id` with a new `note_id` swaps the note it presents, keeping the row's id, parent, and position. A Grouping that had manually chosen that card's note as its cover follows the swap. The note node still holds exactly one note; it never becomes a container.

## Extension: duplicating a Category Placement

`POST /api/nodes/:id/duplicate` copies a top-level Category Placement and every descendant row — Groupings, note cards, catalog entries with their metadata, manual covers, and sibling positions — into another Showcase. The copy is a new set of rows under the shared `categories` label, so it is a separate Placement: notes are referenced rather than cloned, and the source is unchanged. The root appends after the target's last top-level Category, while descendants keep their order. The whole copy is one transaction; a target that already places the label is refused by the one-placement-per-label rule and nothing is written. Duplicating into the source Showcase is therefore refused too.

## Extension: duplicating a Grouping

The same endpoint grows an optional `parent_id`, and a Grouping uses it: a Grouping at any depth is a valid source, and `parent_id` is required. The parent must belong to the target Showcase and be a Category Placement or another Grouping; a note or Catalog entry is refused, as are Notes and Catalog entries as sources. The copied root appends after the chosen parent's last child, while descendants keep their position, manual cover, and catalog metadata. A Grouping copy carries no label, so it may also land in its own Showcase under another parent even though the dialog offers only other Showcases. A Category source keeps its top-level rule and refuses any `parent_id`. Validation answers distinct messages for a missing destination parent, a parent outside the target Showcase, a note or Catalog entry parent, and an unsupported source type; a missing source or target stays a 404. The copy remains one transaction, with notes referenced rather than cloned.
