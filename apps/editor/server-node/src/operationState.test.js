import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOperationAvailable,
  beginOperation,
  createOperationConflictError,
  endOperation,
  getOperationStatus,
  withExclusiveOperation
} from './operationState.js';

beforeEach(() => {
  endOperation();
});

test('status reports idle when no operation is running', () => {
  assert.deepEqual(getOperationStatus(), {
    currentOperation: 'idle',
    isBusy: false,
    startedAt: null,
    details: null
  });
});

test('begin sets a busy status with type and details', () => {
  beginOperation('exporting_archive', { step: 'zip' });
  const status = getOperationStatus();
  assert.equal(status.currentOperation, 'exporting_archive');
  assert.equal(status.isBusy, true);
  assert.equal(typeof status.startedAt, 'string');
  assert.deepEqual(status.details, { step: 'zip' });
});

test('a second begin throws an operation conflict', () => {
  beginOperation('exporting_archive');
  assert.throws(() => beginOperation('importing_archive'), (error) => {
    assert.equal(error.code, 'OPERATION_IN_PROGRESS');
    assert.equal(error.statusCode, 409);
    return true;
  });
});

test('assertOperationAvailable names the blocked action', () => {
  beginOperation('importing_archive');
  assert.throws(() => assertOperationAvailable('Export'), /Export is unavailable while importing archive is in progress\./);
});

test('assertOperationAvailable passes while idle', () => {
  assert.doesNotThrow(() => assertOperationAvailable('Export'));
});

test('end with a mismatched type leaves the operation running', () => {
  beginOperation('exporting_archive');
  endOperation('importing_archive');
  assert.equal(getOperationStatus().currentOperation, 'exporting_archive');
});

test('end with the matching type returns to idle', () => {
  beginOperation('exporting_archive');
  endOperation('exporting_archive');
  assert.equal(getOperationStatus().currentOperation, 'idle');
  assert.equal(getOperationStatus().isBusy, false);
});

test('conflict message uses the action label and a spaced operation name', () => {
  beginOperation('clearing_data');
  const error = createOperationConflictError('Delete');
  assert.match(error.message, /Delete is unavailable while clearing data is in progress\./);
  assert.equal(error.currentOperation, 'clearing_data');
});

test('withExclusiveOperation returns the value and releases the lock', async () => {
  const value = await withExclusiveOperation('exporting_archive', null, async () => 'done');
  assert.equal(value, 'done');
  assert.equal(getOperationStatus().currentOperation, 'idle');
});

test('withExclusiveOperation releases the lock when the work throws', async () => {
  await assert.rejects(
    withExclusiveOperation('importing_archive', null, async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(getOperationStatus().currentOperation, 'idle');
});
