import fs from 'node:fs';

const DESKTOP_PREFERENCES_FILENAME = 'preferences.json';
const DEFAULT_SHOWCASE_PHOTO_SIZE = 'small';
const SHOWCASE_PHOTO_SIZES = new Set(['small', 'medium', 'large']);

function normalizeShowcasePhotoSize(value) {
  return SHOWCASE_PHOTO_SIZES.has(value) ? value : DEFAULT_SHOWCASE_PHOTO_SIZE;
}

function loadDesktopPreferences(preferencesPath) {
  try {
    const raw = fs.readFileSync(preferencesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function readShowcasePhotoSizePreference(preferencesPath) {
  return normalizeShowcasePhotoSize(loadDesktopPreferences(preferencesPath).showcasePhotoSize);
}

function writeShowcasePhotoSizePreference(preferencesPath, value) {
  const normalized = normalizeShowcasePhotoSize(value);
  const preferences = loadDesktopPreferences(preferencesPath);
  fs.writeFileSync(`${preferencesPath}.tmp`, JSON.stringify({ ...preferences, showcasePhotoSize: normalized }));
  fs.renameSync(`${preferencesPath}.tmp`, preferencesPath);
  return normalized;
}

export {
  DEFAULT_SHOWCASE_PHOTO_SIZE,
  DESKTOP_PREFERENCES_FILENAME,
  loadDesktopPreferences,
  normalizeShowcasePhotoSize,
  readShowcasePhotoSizePreference,
  writeShowcasePhotoSizePreference,
};
