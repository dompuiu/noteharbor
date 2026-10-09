# Showcases are one self-referential ordered node tree

A Showcase is stored as a single self-referential `showcase_nodes` table, where every row is a Category Placement, a Grouping, or a note, distinguished by `node_type` and ordered by a per-sibling `position`, rather than as split placement/contents tables or a polymorphic-parent join. This gives one uniform order per node — the "one order" the authoring canvas needs — a tree that is acyclic by construction, cascading subtree deletes, and a single recursive query for "every note beneath a node". Placement is by reference: a Category is a permanent row in a global `categories` pool that each Showcase references, so renaming a label updates every Showcase while its notes and groupings stay local to each Placement.

## Considered Options

- **Split tables** (`showcase_categories` placement + `showcase_items` with two nullable parent foreign keys). Rejected: a node's parent would be polymorphic across two tables, so ordering and subtree traversal would need unions, and "one order per node" would stop being one ordered column.
- **Materialized path / closure table.** Rejected: an extra invariant (path rewriting on every move) for a tree that is small and rarely deep, with no need for ancestor queries beyond a recursive CTE.

## Consequences

- Moving a Grouping or note rewrites only its `position` (and `parent_node_id`); nothing else references its location.
- The tree is acyclic by construction, so no cycle-prevention invariant is required.
- Archive export/import must renumber and remap four reference columns (`showcase_id`, `category_id`, `note_id`, `cover_note_id`) plus the self-referential `parent_node_id`.
- Category labels are permanent: placements reference them with `ON DELETE RESTRICT`, and deleting a label is not an operation, so a label can never be orphaned by a delete.
