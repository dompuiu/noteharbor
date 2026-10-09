import { Router } from 'express';
import {
  addShowcaseNode,
  createShowcase,
  deleteShowcaseById,
  deleteShowcaseNode,
  getAllShowcases,
  getShowcaseById,
  getShowcaseNodeById,
  getShowcaseTree,
  renameShowcaseById,
  reorderShowcases,
  reorderShowcaseNodes,
  updateShowcaseNode
} from '../db.js';

const showcasesRouter = Router();
const nodesRouter = Router();

function normalizeName(value) {
  return String(value ?? '').trim();
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readShowcaseId(request, response) {
  const showcaseId = parseId(request.params.showcaseId);

  if (showcaseId === null) {
    response.status(400).json({ error: 'A valid showcase ID is required.' });
  }

  return showcaseId;
}

showcasesRouter.get('/', (_request, response) => {
  response.json({ showcases: getAllShowcases() });
});

showcasesRouter.post('/', (request, response) => {
  const name = normalizeName(request.body?.name);

  try {
    // An omitted name gets a unique default; the name is optional so the
    // sidebar's `+ New showcase` can create and open one in a single step.
    const showcase = createShowcase(name);
    response.status(201).json({ showcase });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// `/order` must sit before `/:showcaseId` or the literal would match the param.
showcasesRouter.put('/order', (request, response) => {
  const ids = Array.isArray(request.body.ids) ? request.body.ids : null;

  if (!ids) {
    response
      .status(400)
      .json({ error: 'A full ordered list of showcase IDs is required.' });
    return;
  }

  try {
    const showcases = reorderShowcases(ids);
    response.json({ showcases });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

showcasesRouter.put('/:showcaseId', (request, response) => {
  const showcaseId = readShowcaseId(request, response);

  if (showcaseId === null) {
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  const name = normalizeName(request.body?.name);

  if (!name) {
    response.status(400).json({ error: 'Showcase name is required.' });
    return;
  }

  try {
    const showcase = renameShowcaseById(showcaseId, name);
    response.json({ showcase });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

showcasesRouter.delete('/:showcaseId', (request, response) => {
  const showcaseId = readShowcaseId(request, response);

  if (showcaseId === null) {
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  try {
    deleteShowcaseById(showcaseId);
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// The node tree of one Showcase, nested and ordered by `position, id`. Later
// tickets read notes, groupings, and covers off this shape.
showcasesRouter.get('/:id/tree', (request, response) => {
  const showcaseId = parseId(request.params.id);

  if (showcaseId === null) {
    response.status(400).json({ error: 'Showcase id must be a positive integer.' });
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  response.json({
    showcase_id: showcaseId,
    nodes: getShowcaseTree(showcaseId)
  });
});

// Add a node. The body's `type` selects the shape: `category`, `grouping`
// (ticket 09), or the `notes` batch (ticket 10). A single node answers with
// `{ node }`; the note batch answers with `{ nodes }` in the requested order.
showcasesRouter.post('/:id/nodes', (request, response) => {
  const showcaseId = parseId(request.params.id);

  if (showcaseId === null) {
    response.status(400).json({ error: 'Showcase id must be a positive integer.' });
    return;
  }

  if (!getShowcaseById(showcaseId)) {
    response.status(404).json({ error: 'Showcase not found.' });
    return;
  }

  try {
    const result = addShowcaseNode(showcaseId, request.body ?? {});

    if (Array.isArray(result)) {
      response.status(201).json({ nodes: result });
      return;
    }

    response.status(201).json({ node: result });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

nodesRouter.put('/order', (request, response) => {
  const showcaseId = parseId(request.body?.showcase_id);

  if (showcaseId === null) {
    response.status(400).json({ error: 'A valid showcase ID is required.' });
    return;
  }

  // Null/omitted parent means the top level. Accept `parent_id` too so the
  // route matches the add-node descriptor's key.
  const rawParent = request.body?.parent_node_id ?? request.body?.parent_id ?? null;
  const nodeIds = Array.isArray(request.body?.node_ids)
    ? request.body.node_ids
    : Array.isArray(request.body?.ids)
      ? request.body.ids
      : null;

  if (!nodeIds) {
    response
      .status(400)
      .json({ error: 'A full ordered list of child node IDs is required.' });
    return;
  }

  try {
    const nodes = reorderShowcaseNodes(showcaseId, rawParent, nodeIds);
    response.json({ nodes });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// `/order` must sit before `/:id` or the literal would match the param.
nodesRouter.put('/:id', (request, response) => {
  const nodeId = parseId(request.params.id);

  if (nodeId === null) {
    response.status(400).json({ error: 'Node id must be a positive integer.' });
    return;
  }

  if (!getShowcaseNodeById(nodeId)) {
    response.status(404).json({ error: 'Node not found.' });
    return;
  }

  try {
    const node = updateShowcaseNode(nodeId, request.body ?? {});
    response.json({ node });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

nodesRouter.delete('/:id', (request, response) => {
  const nodeId = parseId(request.params.id);

  if (nodeId === null) {
    response.status(400).json({ error: 'Node id must be a positive integer.' });
    return;
  }

  if (!getShowcaseNodeById(nodeId)) {
    response.status(404).json({ error: 'Node not found.' });
    return;
  }

  // The subtree cascades; the label stays in the pool.
  deleteShowcaseNode(nodeId);
  response.json({ success: true });
});

export { nodesRouter, showcasesRouter };
