const headers = {
  'Content-Type': 'application/json'
};

const imageFieldNames = [
  'image_front_full',
  'image_front_thumbnail',
  'image_back_full',
  'image_back_thumbnail'
];
const imageDeleteFieldNames = [
  'delete_image_front_full',
  'delete_image_front_thumbnail',
  'delete_image_back_full',
  'delete_image_back_thumbnail'
];
const generatedThumbnailFieldNames = [
  'generate_image_front_thumbnail_from_full',
  'generate_image_back_thumbnail_from_full'
];

function isFileValue(value) {
  return (
    (typeof File !== 'undefined' && value instanceof File) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function buildNoteRequestOptions(method, payload) {
  const shouldUseFormData =
    Object.values(payload).some(isFileValue) ||
    Object.keys(payload).some((k) => k.endsWith('_url'));

  if (!shouldUseFormData) {
    return {
      method,
      headers,
      body: JSON.stringify(payload)
    };
  }

  const formData = new FormData();

  Object.entries(payload).forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    if (key === 'tags' && Array.isArray(value)) {
      value.forEach((tag) => {
        formData.append('tags', tag);
      });
      return;
    }

    if (imageFieldNames.includes(key)) {
      if (isFileValue(value)) {
        const fallbackName = `${key}.png`;
        formData.append(key, value, value.name || fallbackName);
      }
      return;
    }

    if (imageDeleteFieldNames.includes(key) || generatedThumbnailFieldNames.includes(key)) {
      formData.append(key, value ? 'true' : 'false');
      return;
    }

    if (key === 'scraped_data') {
      formData.append(key, JSON.stringify(value));
      return;
    }

    formData.append(key, value);
  });

  return {
    method,
    body: formData
  };
}

// The one translation from an HTTP status to the shell's connection vocabulary.
// A 503 is the database-aware health signal (/api/health and the DB error
// handler); anything else the server answered is reported generically.
function reasonForStatus(status) {
  return status === 503 ? 'database' : 'generic';
}

// A failed request carries why it failed so the shell can show the right
// connection message; the message itself falls back to the generic copy.
function connectionError(reason, message) {
  const error = new Error(message || 'Request failed.');
  error.reason = reason;
  return error;
}

async function handleResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The shell reads its connection state from the collections load, so a
    // failure has to say whether the server answered but its database did not.
    throw connectionError(reasonForStatus(response.status), payload.error);
  }

  return payload;
}

function parseJsonText(responseText) {
  try {
    const payload = JSON.parse(responseText);
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

function toUploadProgressEvent(event) {
  if (event?.lengthComputable && Number(event.total) > 0) {
    const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));

    return { loaded: event.loaded, total: event.total, percent, phase: 'uploading' };
  }

  return { loaded: event?.loaded ?? 0, total: null, percent: null, phase: 'uploading' };
}

function postFormDataWithUploadProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        onProgress(toUploadProgressEvent(event));
      };
      xhr.upload.onload = () => {
        onProgress({ loaded: null, total: null, percent: 100, phase: 'processing' });
      };
    }

    xhr.onload = () => {
      const payload = parseJsonText(xhr.responseText);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error || 'Request failed.'));
    };
    xhr.onerror = () => {
      reject(new Error('Request failed.'));
    };
    xhr.send(formData);
  });
}

function notesBasePath(collectionId) {
  return Number.isInteger(collectionId)
    ? `/api/collections/${collectionId}/notes`
    : '/api/notes';
}

function tagsBasePath(collectionId) {
  return Number.isInteger(collectionId)
    ? `/api/collections/${collectionId}/tags`
    : '/api/tags';
}

function importBasePath(collectionId) {
  return Number.isInteger(collectionId)
    ? `/api/collections/${collectionId}/import`
    : '/api/import';
}

async function getCollections() {
  let response;

  try {
    response = await fetch('/api/collections');
  } catch {
    // Nothing answered at all, which the shell reports as a server problem.
    throw connectionError('server');
  }

  return handleResponse(response);
}

// Distils `/api/health` into the shell's connection state. A thrown fetch means
// the editor server itself is unreachable; a 503 means the server answered but
// its database did not; anything else unexpected is reported generically.
async function getHealth() {
  let response;

  try {
    response = await fetch('/api/health');
  } catch {
    return { connected: false, reason: 'server' };
  }

  if (response.status !== 200) {
    return { connected: false, reason: reasonForStatus(response.status) };
  }

  const payload = await response.json().catch(() => ({}));
  return payload?.ok === true
    ? { connected: true }
    : { connected: false, reason: 'generic' };
}

async function createCollection(name) {
  const response = await fetch('/api/collections', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function renameCollection(collectionId, name) {
  const response = await fetch(`/api/collections/${collectionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function deleteCollection(collectionId) {
  const response = await fetch(`/api/collections/${collectionId}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function setDefaultCollection(collectionId) {
  const response = await fetch(`/api/collections/${collectionId}/default`, {
    method: 'PUT'
  });

  return handleResponse(response);
}

async function reorderCollections(ids) {
  const response = await fetch('/api/collections/reorder', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getNotes(collectionId) {
  const response = await fetch(notesBasePath(collectionId));
  return handleResponse(response);
}

async function reorderNotes(ids, collectionId) {
  const response = await fetch(`${notesBasePath(collectionId)}/reorder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getNote(id, collectionId) {
  const response = await fetch(`${notesBasePath(collectionId)}/${id}`);
  return handleResponse(response);
}

async function createNote(payload, collectionId) {
  const response = await fetch(notesBasePath(collectionId), buildNoteRequestOptions('POST', payload));

  return handleResponse(response);
}

async function updateNote(id, payload, collectionId) {
  const response = await fetch(`${notesBasePath(collectionId)}/${id}`, buildNoteRequestOptions('PUT', payload));

  return handleResponse(response);
}

async function deleteNote(id, collectionId) {
  const response = await fetch(`${notesBasePath(collectionId)}/${id}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function moveNote(id, collectionId, targetCollectionId, position) {
  const response = await fetch(`${notesBasePath(collectionId)}/${id}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      target_collection_id: targetCollectionId,
      position_mode: position?.mode,
      position_reference_id: position?.referenceId ?? null
    })
  });

  return handleResponse(response);
}

async function importCsv(source, collectionId, onProgress) {
  const formData = new FormData();

  if (isFileValue(source)) {
    formData.append('file', source);
  } else if (typeof source === 'string' && source.trim()) {
    formData.append('csv_text', source);
  } else {
    throw new Error('Choose a CSV file or paste CSV text before importing.');
  }

  return postFormDataWithUploadProgress(importBasePath(collectionId), formData, onProgress);
}

async function importArchive(file, onProgress) {
  if (!isFileValue(file)) {
    throw new Error('Choose a .zip archive before importing.');
  }

  const formData = new FormData();
  formData.append('file', file);

  return postFormDataWithUploadProgress('/api/archive/import', formData, onProgress);
}

async function downloadArchive(collectionIds = null) {
  const searchParams = new URLSearchParams();

  if (Array.isArray(collectionIds) && collectionIds.length) {
    searchParams.set('collectionIds', collectionIds.join(','));
  }

  searchParams.set('_ts', String(Date.now()));

  const query = searchParams.toString();
  const response = await fetch(`/api/archive/export?${query}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    return handleResponse(response);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const filenameMatch = contentDisposition.match(/filename="?([^\"]+)"?/i);
  const filename = filenameMatch?.[1] || 'noteharbor-archive.zip';
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);

  return { filename };
}

async function getOperationStatus() {
  const response = await fetch('/api/operations/status');
  return handleResponse(response);
}

async function clearAppData() {
  const response = await fetch('/api/archive/data', {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function getTags(collectionId) {
  const response = await fetch(`${tagsBasePath(collectionId)}/suggestions`);
  return handleResponse(response);
}

async function getShowcases() {
  const response = await fetch('/api/showcases');
  return handleResponse(response);
}

async function createShowcase(name) {
  const response = await fetch('/api/showcases', {
    method: 'POST',
    headers,
    body: JSON.stringify(name ? { name } : {})
  });

  return handleResponse(response);
}

async function getCategories() {
  const response = await fetch('/api/categories');
  return handleResponse(response);
}

async function createCategory(name) {
  const response = await fetch('/api/categories', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function renameCategory(id, name) {
  const response = await fetch(`/api/categories/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function getShowcaseTree(showcaseId) {
  const response = await fetch(`/api/showcases/${showcaseId}/tree`);
  return handleResponse(response);
}

async function createShowcaseNode(showcaseId, payload) {
  const response = await fetch(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

async function updateNode(id, payload) {
  const response = await fetch(`/api/nodes/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

async function deleteNode(id) {
  const response = await fetch(`/api/nodes/${id}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

const SCRAPE_PREVIEW_TIMEOUT_BUFFER_MS = 5000;
const SCRAPE_NAVIGATION_TIMEOUT_MAX_MS = 120000;

const scrapeTimeoutMessage =
  'Autopopulate timed out before the page loaded. Check the Chrome window for a ' +
  'new-profile setup screen or a bot check, then try again.';

async function scrapePreview(url, { timeoutMs } = {}) {
  const clampedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, SCRAPE_NAVIGATION_TIMEOUT_MAX_MS)
    : null;

  const controller = new AbortController();
  const abortTimer = clampedTimeoutMs
    ? setTimeout(
        () => controller.abort(),
        clampedTimeoutMs + SCRAPE_PREVIEW_TIMEOUT_BUFFER_MS
      )
    : null;

  try {
    const response = await fetch('/api/scrape/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, timeoutMs: clampedTimeoutMs }),
      signal: controller.signal
    });

    return await handleResponse(response);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(scrapeTimeoutMessage);
    }

    if (/timed out|timeout .*exceeded/i.test(error.message || '')) {
      throw new Error(scrapeTimeoutMessage);
    }

    throw error;
  } finally {
    if (abortTimer) {
      clearTimeout(abortTimer);
    }
  }
}

export {
  clearAppData,
  createCategory,
  createCollection,
  createNote,
  createShowcase,
  createShowcaseNode,
  deleteCollection,
  deleteNode,
  deleteNote,
  downloadArchive,
  getCategories,
  getCollections,
  getHealth,
  getNote,
  getNotes,
  getOperationStatus,
  getShowcaseTree,
  getShowcases,
  getTags,
  importArchive,
  importCsv,
  moveNote,
  renameCategory,
  renameCollection,
  reorderCollections,
  reorderNotes,
  scrapePreview,
  scrapeTimeoutMessage,
  setDefaultCollection,
  updateNode,
  updateNote
};
