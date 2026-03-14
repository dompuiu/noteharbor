const headers = {
  'Content-Type': 'application/json'
};

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

async function getNote(id) {
  const response = await fetch(`/api/notes/${id}`);
  return handleResponse(response);
}

async function updateNote(id, payload) {
  const response = await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

async function importCsv(file) {
  const formData = new FormData();
  formData.append('file', file);

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

export { getNote, getNotes, getScrapeStatus, getTags, importCsv, startScrape, updateNote };
