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

async function handleResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
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
  const response = await fetch('/api/collections');
  return handleResponse(response);
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

async function importCsv(source, collectionId) {
  const formData = new FormData();

  if (isFileValue(source)) {
    formData.append('file', source);
  } else if (typeof source === 'string' && source.trim()) {
    formData.append('csv_text', source);
  } else {
    throw new Error('Choose a CSV file or paste CSV text before importing.');
  }

  const response = await fetch(importBasePath(collectionId), {
    method: 'POST',
    body: formData
  });

  return handleResponse(response);
}

async function importArchive(file) {
  if (!isFileValue(file)) {
    throw new Error('Choose a .zip archive before importing.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/archive/import', {
    method: 'POST',
    body: formData
  });

  return handleResponse(response);
}

async function downloadArchive(collectionIds = null) {
  const searchParams = new URLSearchParams();

  if (Array.isArray(collectionIds) && collectionIds.length) {
    searchParams.set('collectionIds', collectionIds.join(','));
  }

  const query = searchParams.toString();
  const response = await fetch(query ? `/api/archive/export?${query}` : '/api/archive/export');

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

async function scrapePreview(url) {
  const response = await fetch('/api/scrape/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url })
  });

  return handleResponse(response);
}

async function startScrape(ids) {
  const response = await fetch('/api/scrape/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getScrapeStatus() {
  const response = await fetch('/api/scrape/status');
  return handleResponse(response);
}

export {
  clearAppData,
  createCollection,
  createNote,
  deleteCollection,
  deleteNote,
  downloadArchive,
  getCollections,
  getNote,
  getNotes,
  getOperationStatus,
  getScrapeStatus,
  getTags,
  importArchive,
  importCsv,
  renameCollection,
  reorderNotes,
  scrapePreview,
  setDefaultCollection,
  startScrape,
  updateNote
};
