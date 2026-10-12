import { Router } from 'express';
import { getOperationStatus } from '../operationState.js';

const operationsRouter = Router();

operationsRouter.get('/status', (_request, response) => {
  response.json(getOperationStatus());
});

export { operationsRouter };
