const operationState = {
  currentOperation: 'idle',
  startedAt: null,
  details: null
};

function getOperationStatus() {
  return {
    currentOperation: operationState.currentOperation,
    isBusy: operationState.currentOperation !== 'idle',
    startedAt: operationState.startedAt,
    details: operationState.details
  };
}

function createOperationConflictError(actionLabel = 'This action') {
  const error = new Error(`${actionLabel} is unavailable while ${operationState.currentOperation.replace(/_/g, ' ')} is in progress.`);
  error.statusCode = 409;
  error.code = 'OPERATION_IN_PROGRESS';
  error.currentOperation = operationState.currentOperation;
  return error;
}

function beginOperation(type, details = null) {
  if (operationState.currentOperation !== 'idle') {
    throw createOperationConflictError();
  }

  operationState.currentOperation = type;
  operationState.startedAt = new Date().toISOString();
  operationState.details = details;
}

function endOperation(type) {
  if (type && operationState.currentOperation !== type) {
    return;
  }

  operationState.currentOperation = 'idle';
  operationState.startedAt = null;
  operationState.details = null;
}

function assertOperationAvailable(actionLabel) {
  if (operationState.currentOperation !== 'idle') {
    throw createOperationConflictError(actionLabel);
  }
}

async function withExclusiveOperation(type, details, fn) {
  beginOperation(type, details);

  try {
    return await fn();
  } finally {
    endOperation(type);
  }
}

export {
  assertOperationAvailable,
  beginOperation,
  createOperationConflictError,
  endOperation,
  getOperationStatus,
  withExclusiveOperation
};
