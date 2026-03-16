function parseBooleanEnv(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "on"].includes(normalized);
}

const isReadOnlyMode = parseBooleanEnv(import.meta.env.VITE_READ_ONLY_MODE);

export { isReadOnlyMode };
