import { describe, expect, it } from '@jest/globals';

import {
  activeCollectionForDataset,
  activeCollectionIdForDataset,
  activeCollectionNotes,
  datasetSourceLabel,
  filterViewerNotes,
  noteFullImage,
  notePreviewImage,
  noteTagsLabel,
  noteTitle,
  noteValueForColumn,
  parseViewerQuery,
  sortViewerNotes,
  type ViewerDataset,
} from './index';

const dataset: ViewerDataset = {
  generatedAt: '2026-05-30T00:00:00.000Z',
  noteCount: 2,
  source: 'imported',
  collections: [
    { id: 10, name: 'World Notes', noteCount: 1, isDefault: false },
    { id: 11, name: 'Default', noteCount: 1, isDefault: false },
  ],
  notes: [
    {
      id: 1,
      collectionId: 10,
      displayOrder: 1,
      denomination: '5 Lei',
      issueDate: '1991',
      catalogNumber: 'P-98',
      gradingCompany: 'PMG',
      grade: '64',
      watermark: '',
      serial: 'AB123',
      url: '',
      notes: 'First note',
      scrapeStatus: 'done',
      scrapeError: '',
      tags: [{ name: 'Romania' }, { name: 'Polymer' }],
      images: [
        { type: 'front', variant: 'thumbnail', filePath: '/tmp/front-thumb.jpg' },
        { type: 'front', variant: 'full', filePath: '/tmp/front-full.jpg' },
      ],
      scrapedData: null,
    },
    {
      id: 2,
      collectionId: 11,
      displayOrder: 2,
      denomination: '',
      issueDate: '',
      catalogNumber: '',
      gradingCompany: '',
      grade: '',
      watermark: '',
      serial: '',
      url: '',
      notes: '',
      scrapeStatus: '',
      scrapeError: '',
      tags: [],
      images: [],
      scrapedData: null,
    },
  ],
};

describe('viewer core dataset rules', () => {
  it('returns source labels', () => {
    expect(datasetSourceLabel('bundled')).toBe('Using bundled dataset');
    expect(datasetSourceLabel('imported')).toBe('Using imported archive');
  });

  it('derives note titles and tags labels', () => {
    expect(noteTitle(dataset.notes[0])).toBe('5 Lei - P-98');
    expect(noteTitle(dataset.notes[1])).toBe('Untitled note');
    expect(noteTagsLabel(dataset.notes[0])).toBe('Romania, Polymer');
  });

  it('resolves note values and images', () => {
    expect(noteValueForColumn(dataset.notes[0], 'catalogNumber')).toBe('P-98');
    expect(noteValueForColumn(dataset.notes[0], 'tags')).toBe('Romania, Polymer');
    expect(notePreviewImage(dataset.notes[0], 'front')?.variant).toBe('thumbnail');
    expect(noteFullImage(dataset.notes[0], 'front')?.variant).toBe('full');
  });

  it('picks the named default collection when no explicit default exists', () => {
    expect(activeCollectionIdForDataset(dataset)).toBe(11);
    expect(activeCollectionForDataset(dataset)?.id).toBe(11);
    expect(activeCollectionNotes(dataset).map((note) => note.id)).toEqual([2]);
  });

  it('keeps a valid current collection selection', () => {
    expect(activeCollectionIdForDataset(dataset, 10)).toBe(10);
    expect(activeCollectionNotes(dataset, 10).map((note) => note.id)).toEqual([1]);
  });

  it('falls back to the first collection when no default is available', () => {
    const withoutDefaultName: ViewerDataset = {
      ...dataset,
      collections: [
        { id: 20, name: 'Alpha', noteCount: 0, isDefault: false },
        { id: 21, name: 'Beta', noteCount: 0, isDefault: false },
      ],
      notes: [],
    };

    expect(activeCollectionIdForDataset(withoutDefaultName)).toBe(20);
  });

  it('parses mixed free text and field-scoped filters', () => {
    expect(parseViewerQuery('romania catalog: p-98 denom: 5 lei')).toEqual({
      allFields: 'romania',
      fields: {
        catalogNumber: 'p-98',
        denomination: '5 lei',
      },
    });
  });

  it('filters by tags, catalog prefix, and denomination numbers', () => {
    expect(filterViewerNotes(dataset.notes, 'tags: romania').map((note) => note.id)).toEqual([1]);
    expect(filterViewerNotes(dataset.notes, 'catalog: p-98').map((note) => note.id)).toEqual([1]);
    expect(filterViewerNotes(dataset.notes, 'denom: 5').map((note) => note.id)).toEqual([1]);
  });

  it('supports negation and multi-value tag filters', () => {
    expect(filterViewerNotes(dataset.notes, 'tags: romania,!polymer')).toEqual([]);
    expect(filterViewerNotes(dataset.notes, 'tags: romania,polymer').map((note) => note.id)).toEqual([1]);
  });

  it('preserves date commas and thousand separators while splitting multi-value filters', () => {
    const notes = [
      {
        ...dataset.notes[0],
        issueDate: 'March 12, 1991',
        denomination: '1,000 Lei',
      },
    ];

    expect(filterViewerNotes(notes, 'date: march 12, 1991').map((note) => note.id)).toEqual([1]);
    expect(filterViewerNotes(notes, 'denom: 1000').map((note) => note.id)).toEqual([1]);
  });

  it('sorts notes by display order and text columns', () => {
    const sortedByOrder = sortViewerNotes(dataset.notes, 'displayOrder', false);
    expect(sortedByOrder.map((note) => note.id)).toEqual([2, 1]);

    const sortedByCatalog = sortViewerNotes(dataset.notes, 'catalogNumber', true);
    expect(sortedByCatalog.map((note) => note.id)).toEqual([2, 1]);
  });
});
