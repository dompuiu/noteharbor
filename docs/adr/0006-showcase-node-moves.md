# Moving a node across parents

`PUT /api/nodes/:id/move` reparents one node atomically: the body carries
`parent_node_id` (null only for a top-level Category Placement) and a zero-based
`position` counted against the target sibling list after the source is removed.
The server validates placement (top-level categories only; notes, placeholders
and groupings need a category or grouping; only a category or grouping can hold
items), refuses a target inside the moved node's own subtree, renumbers both
sibling lists in one transaction, and returns the updated node. The client sends
the same shape, moving optimistically and restoring the previous tree on failure.

This replaces the previous assumption that nodes only change order inside one
parent. `PUT /api/nodes/order` still requires a full permutation of one parent's
children and remains the reorder call.

## Consequences

- ADR-0001's "acyclic by construction" no longer holds once a parent can change:
  the move endpoint is now the one place that must enforce acyclicity. The check
  walks the target's parent chain, so the invariant has a single owner.
- Both sibling lists are rewritten; a move is not a single-row `position` update.
- Placement rules are duplicated between creation and moving on purpose: a move
  can invalidate a node type's parent requirement, so it must answer the same
  errors the create paths do.
