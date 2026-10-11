import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeShowcasePhotoSize,
  readShowcasePhotoSizePreference,
  writeShowcasePhotoSizePreference,
} from './preferences.js';

function tempPreferencesPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-prefs-')), 'preferences.json');
}

describe('desktop showcase photo size preferences', () => {
  it('defaults to small when no file exists', () => {
    assert.equal(readShowcasePhotoSizePreference(tempPreferencesPath()), 'small');
  });

  it('round-trips the chosen size across restarts', () => {
    const preferencesPath = tempPreferencesPath();
    assert.equal(writeShowcasePhotoSizePreference(preferencesPath, 'large'), 'large');
    assert.equal(readShowcasePhotoSizePreference(preferencesPath), 'large');
    assert.equal(fs.existsSync(`${preferencesPath}.tmp`), false);
  });

  it('normalizes unknown values instead of persisting them', () => {
    const preferencesPath = tempPreferencesPath();
    assert.equal(writeShowcasePhotoSizePreference(preferencesPath, 'gigantic'), 'small');
    assert.equal(readShowcasePhotoSizePreference(preferencesPath), 'small');
    assert.equal(normalizeShowcasePhotoSize(undefined), 'small');
  });

  it('preserves unrelated preferences when updating the photo size', () => {
    const preferencesPath = tempPreferencesPath();
    fs.writeFileSync(preferencesPath, JSON.stringify({ windowWidth: 1480 }));
    writeShowcasePhotoSizePreference(preferencesPath, 'medium');
    const parsed = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    assert.equal(parsed.showcasePhotoSize, 'medium');
    assert.equal(parsed.windowWidth, 1480);
  });
});
