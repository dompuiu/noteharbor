// Tag name rules shared by every Tag surface: trim and collapse whitespace,
// compare case-insensitively, and split a pasted comma list into names. The
// server's `normalize_tag_name` mirrors this; keep the two in step.
export const normalizeTag = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export const tagKey = (value) => normalizeTag(value).toLowerCase();

export const splitTagInput = (raw) =>
  String(raw ?? "")
    .split(",")
    .map(normalizeTag)
    .filter(Boolean);
