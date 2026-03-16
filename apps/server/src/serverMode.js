function parseBooleanEnv(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function shouldUseReadOnlyMode() {
  return parseBooleanEnv(process.env.NOTESSHOW_READ_ONLY_MODE);
}

function rejectReadOnly(response) {
  response.status(403).json({ error: 'This build is read only.' });
}

export {
  parseBooleanEnv,
  rejectReadOnly,
  shouldUseReadOnlyMode
};
