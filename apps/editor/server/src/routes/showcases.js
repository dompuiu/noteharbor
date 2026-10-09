import { Router } from 'express';
import {
  addShowcaseNode,
  createShowcase,
  deleteShowcaseNode,
  getAllShowcases,
  getShowcaseById,
  getShowcaseNodeById,
  getShowcaseTree,
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

// Add one node. The body's `type` selects the shape: `category` today, with
// `grouping` (ticket 09) and the `notes` batch (ticket 10) to follow. The
// server resolves or creates the Category label and appends at the end.
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
    const node = addShowcaseNode(showcaseId, request.body ?? {});
    response.status(201).json({ node });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

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
