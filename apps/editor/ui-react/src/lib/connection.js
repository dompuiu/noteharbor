// The two failures the shell can explain: nothing answered at all ('server'),
// or the server answered but its database did not ('database'). Everything else
// stays with the screen that made the request.
const CONNECTION_REASONS = new Set(['server', 'database']);

function isConnectionReason(reason) {
  return CONNECTION_REASONS.has(reason);
}

// Screens report a failed *load* here rather than through props, so the shell's
// one connection state hears it without each parent passing the failure up.
// Mutations do not report: a failed save keeps its form and its inline error
// instead of being replaced by the shell card mid-edit.
const listeners = new Set();

// Returns whether the failure was a connection one, so a caller can promote it
// and skip its own local error in one step.
function reportConnectionFailure(reason) {
  if (!isConnectionReason(reason)) {
    return false;
  }

  listeners.forEach((listener) => listener(reason));
  return true;
}

function subscribeConnectionFailure(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export {
  isConnectionReason,
  reportConnectionFailure,
  subscribeConnectionFailure,
};
