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

// Every fetch goes through here, so a dead server reads the same whether it is
// found at boot, on a route change, or inside a screen's own load. An abort is
// the caller's own timeout and stays a plain abort.
async function request(url, options) {
  try {
    // Keep a plain GET a one-argument fetch call, the shape the API tests read.
    return await (options === undefined ? fetch(url) : fetch(url, options));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    throw connectionError('server');
  }
}

async function handleResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
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

      reject(connectionError(reasonForStatus(xhr.status), payload.error));
    };
    xhr.onerror = () => {
      reject(connectionError('server'));
    };
    xhr.send(formData);
  });
}

function notesBasePath(collectionId) {
  return Number.isInteger(collectionId)
    ? `/api/collections/${collectionId}/notes`
    : '/api/notes';
}

// A projected list asks for just the fields a screen paints. The server builds
// its SELECT from this list, so an omitted field is never read or transferred.
function fieldsQuery(fields) {
  const names = (fields ?? []).filter(Boolean);

  // Field names are a fixed `[a-z_]` set, so a plain comma list needs no
  // encoding and matches the server's `fields=a,b` parsing exactly.
  return names.length ? `?fields=${names.join(',')}` : '';
}

function tagsBasePath(collectionId) {
  return Number.isInteger(collectionId)
    ? `/api/collections/${collectionId}/tags`
    : '/api/tags';
}

async function getCollections() {
  const response = await request('/api/collections');
  return handleResponse(response);
}

// Distils `/api/health` into the shell's connection state. A thrown fetch means
// the editor server itself is unreachable; a 503 means the server answered but
// its database did not; anything else unexpected is reported generically.
async function getHealth() {
  let response;

  try {
    response = await request('/api/health');
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
  const response = await request('/api/collections', {
    method: 'POST',
    headers,
    body: JSON.stringify(name ? { name } : {})
  });

  return handleResponse(response);
}

async function renameCollection(collectionId, name) {
  const response = await request(`/api/collections/${collectionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function deleteCollection(collectionId) {
  const response = await request(`/api/collections/${collectionId}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function reorderCollections(ids) {
  const response = await request('/api/collections/reorder', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getNotes(collectionId, fields) {
  const response = await request(`${notesBasePath(collectionId)}${fieldsQuery(fields)}`);
  return handleResponse(response);
}

// The All notes screen's single data seam. There is no cross-collection server
// endpoint yet, so this fans out one request per collection and flattens the
// results in sidebar order. Each note carries the collection it came from, so
// the screen never has to join the two lists itself. `fields` narrows every
// per-collection request (see `allNotesListFields`). A future
// `GET /api/notes?scope=all` replaces only this function.
async function getAllNotes(collections, fields) {
  const perCollection = await Promise.all(
    (collections ?? []).map(async (collection, index) => {
      const payload = await getNotes(collection.id, fields);

      return (payload.notes ?? []).map((note) => ({
        ...note,
        collection_id: note.collection_id ?? collection.id,
        collection: collection.name,
        collection_name: collection.name,
        collection_order: index + 1
      }));
    })
  );

  return { notes: perCollection.flat() };
}

async function reorderNotes(ids, collectionId) {
  const response = await request(`${notesBasePath(collectionId)}/reorder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getNote(id, collectionId) {
  const response = await request(`${notesBasePath(collectionId)}/${id}`);
  return handleResponse(response);
}

async function createNote(payload, collectionId) {
  const response = await request(notesBasePath(collectionId), buildNoteRequestOptions('POST', payload));

  return handleResponse(response);
}

async function updateNote(id, payload, collectionId) {
  const response = await request(`${notesBasePath(collectionId)}/${id}`, buildNoteRequestOptions('PUT', payload));

  return handleResponse(response);
}

async function deleteNote(id, collectionId) {
  const response = await request(`${notesBasePath(collectionId)}/${id}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function moveNote(id, collectionId, targetCollectionId, position) {
  const response = await request(`${notesBasePath(collectionId)}/${id}/move`, {
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

async function moveNotes(ids, sourceCollectionId, targetCollectionId, position) {
  const response = await request(`${notesBasePath(sourceCollectionId)}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      note_ids: ids,
      target_collection_id: targetCollectionId,
      position_mode: position?.mode,
      position_reference_id: position?.referenceId ?? null
    })
  });

  return handleResponse(response);
}

async function updateNotesTags(collectionId, noteIds, add, remove) {
  const response = await request(`/api/collections/${collectionId}/notes/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      note_ids: noteIds,
      add,
      remove
    })
  });

  return handleResponse(response);
}

async function importArchive(file, onProgress, mode = 'replace') {
  if (!isFileValue(file)) {
    throw new Error('Choose a .zip archive before importing.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const searchParams = new URLSearchParams();

  if (mode) {
    searchParams.set('mode', mode);
  }

  const query = searchParams.toString();
  const url = query ? `/api/archive/import?${query}` : '/api/archive/import';

  return postFormDataWithUploadProgress(url, formData, onProgress);
}

async function downloadArchive(collectionIds = null, showcaseIds = undefined) {
  const searchParams = new URLSearchParams();

  if (Array.isArray(collectionIds) && collectionIds.length) {
    searchParams.set('collectionIds', collectionIds.join(','));
  }

  // An explicit showcase selection always travels (even when empty, as an
  // empty `showcaseIds` value meaning "no showcases") so the server can tell
  // "export no showcases" apart from the legacy "no showcase filter".
  if (Array.isArray(showcaseIds)) {
    searchParams.set('showcaseIds', showcaseIds.join(','));
  }

  searchParams.set('_ts', String(Date.now()));

  const query = searchParams.toString();
  const response = await request(`/api/archive/export?${query}`, {
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

  // A filtered export reports the showcases it could not include because they
  // reached notes outside the selection. The header is JSON, percent-encoded
  // by the server so a name stays header-safe.
  const omittedHeader = response.headers.get('x-noteharbor-omitted-showcases');
  let omittedShowcases = [];

  if (omittedHeader) {
    try {
      const parsed = JSON.parse(decodeURIComponent(omittedHeader));
      if (Array.isArray(parsed)) {
        omittedShowcases = parsed.map((name) => String(name));
      }
    } catch {
      omittedShowcases = [];
    }
  }

  return { filename, omittedShowcases };
}

async function getOperationStatus() {
  const response = await request('/api/operations/status');
  return handleResponse(response);
}

async function clearAppData() {
  const response = await request('/api/archive/data', {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function getTags(collectionId) {
  const response = await request(`${tagsBasePath(collectionId)}/suggestions`);
  return handleResponse(response);
}

async function getShowcases() {
  const response = await request('/api/showcases');
  return handleResponse(response);
}

async function createShowcase(name) {
  const response = await request('/api/showcases', {
    method: 'POST',
    headers,
    body: JSON.stringify(name ? { name } : {})
  });

  return handleResponse(response);
}

async function getCategories() {
  const response = await request('/api/categories');
  return handleResponse(response);
}

async function createCategory(name) {
  const response = await request('/api/categories', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function renameCategory(id, name) {
  const response = await request(`/api/categories/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function getShowcaseTree(showcaseId) {
  const response = await request(`/api/showcases/${showcaseId}/tree`);
  return handleResponse(response);
}

async function createShowcaseNode(showcaseId, payload) {
  const response = await request(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

async function updateNode(id, payload) {
  const response = await request(`/api/nodes/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

async function deleteNode(id) {
  const response = await request(`/api/nodes/${id}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function renameShowcase(showcaseId, name) {
  const response = await request(`/api/showcases/${showcaseId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name })
  });

  return handleResponse(response);
}

async function deleteShowcase(showcaseId) {
  const response = await request(`/api/showcases/${showcaseId}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function reorderShowcases(ids) {
  const response = await request('/api/showcases/order', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function reorderNodes(showcaseId, parentNodeId, nodeIds) {
  const response = await request('/api/nodes/order', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      showcase_id: showcaseId,
      parent_node_id: parentNodeId ?? null,
      node_ids: nodeIds
    })
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
    const response = await request('/api/scrape/preview', {
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
  deleteShowcase,
  downloadArchive,
  getCategories,
  getCollections,
  getHealth,
  getAllNotes,
  getNote,
  getNotes,
  getOperationStatus,
  getShowcaseTree,
  getShowcases,
  getTags,
  importArchive,
  moveNote,
  moveNotes,
  renameCategory,
  renameCollection,
  renameShowcase,
  reorderCollections,
  reorderNodes,
  reorderNotes,
  reorderShowcases,
  scrapePreview,
  scrapeTimeoutMessage,
  updateNode,
  updateNote,
  updateNotesTags
};
