const headers = {
  'Content-Type': 'application/json'
};

const imageFieldNames = [
  'image_front_full',
  'image_front_thumbnail',
  'image_back_full',
  'image_back_thumbnail'
];

function isFileValue(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function buildNoteRequestOptions(method, payload) {
  const shouldUseFormData = Object.values(payload).some(isFileValue);

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
        formData.append(key, value);
      }
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

async function getNotes() {
  const response = await fetch('/api/notes');
  return handleResponse(response);
}

async function reorderNotes(ids) {
  const response = await fetch('/api/notes/reorder', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids })
  });

  return handleResponse(response);
}

async function getNote(id) {
  const response = await fetch(`/api/notes/${id}`);
  return handleResponse(response);
}

async function createNote(payload) {
  const response = await fetch('/api/notes', buildNoteRequestOptions('POST', payload));

  return handleResponse(response);
}

async function updateNote(id, payload) {
  const response = await fetch(`/api/notes/${id}`, buildNoteRequestOptions('PUT', payload));

  return handleResponse(response);
}

async function deleteNote(id) {
  const response = await fetch(`/api/notes/${id}`, {
    method: 'DELETE'
  });

  return handleResponse(response);
}

async function importCsv(source) {
  const formData = new FormData();

  if (isFileValue(source)) {
    formData.append('file', source);
  } else if (typeof source === 'string' && source.trim()) {
    formData.append('csv_text', source);
  } else {
    throw new Error('Choose a CSV file or paste CSV text before importing.');
  }

  const response = await fetch('/api/import', {
    method: 'POST',
    body: formData
  });

  return handleResponse(response);
}

async function getTags() {
  const response = await fetch('/api/tags/suggestions');
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
  createNote,
  deleteNote,
  getNote,
  getNotes,
  getScrapeStatus,
  getTags,
  importCsv,
  reorderNotes,
  startScrape,
  updateNote
};
