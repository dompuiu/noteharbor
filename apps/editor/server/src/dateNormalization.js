function normalizeIssueDate(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized || /^\d{4}$/.test(normalized) || !normalized.includes('/')) {
    return normalized;
  }

  const parts = normalized.split('/');

  return parts
    .map((part, index) => {
      if (index < 2 && /^\d$/.test(part)) {
        return `0${part}`;
      }

      return part;
    })
    .join('/');
}

export { normalizeIssueDate };
