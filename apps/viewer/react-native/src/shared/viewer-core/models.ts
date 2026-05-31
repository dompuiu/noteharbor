export type DatasetSource = 'bundled' | 'imported';

export interface Tag {
  id?: number;
  name: string;
}

export interface NoteImage {
  assetPath?: string;
  filePath?: string;
  type: string;
  variant: string;
  sourceUrl?: string;
}

export interface NoteRecord {
  id: number;
  collectionId: number;
  displayOrder: number;
  denomination: string;
  issueDate: string;
  catalogNumber: string;
  gradingCompany: string;
  grade: string;
  watermark: string;
  serial: string;
  url: string;
  notes: string;
  scrapeStatus: string;
  scrapeError: string;
  tags: Tag[];
  images: NoteImage[];
  scrapedData?: Record<string, unknown> | null;
}

export interface ViewerCollection {
  id: number;
  name: string;
  noteCount: number;
  isDefault: boolean;
}

export interface ViewerDataset {
  generatedAt?: string | null;
  noteCount: number;
  notes: NoteRecord[];
  collections: ViewerCollection[];
  source: DatasetSource;
}

export interface ParsedQuery {
  allFields: string;
  fields: Record<string, string>;
}

export const viewerCoreVersion = '0.1.0';

export function describeViewerCore() {
  return 'Note Harbor viewer core is connected.';
}

export function datasetSourceLabel(source: DatasetSource) {
  return source === 'imported'
    ? 'Using imported archive'
    : 'Using bundled dataset';
}

export function noteTitle(note: NoteRecord) {
  if (note.denomination && note.catalogNumber) {
    return `${note.denomination} - ${note.catalogNumber}`;
  }

  return note.denomination || 'Untitled note';
}

export function noteTagsLabel(note: NoteRecord) {
  return note.tags
    .map((tag) => tag.name)
    .filter((name) => name.trim().length > 0)
    .join(', ');
}

export function noteValueForColumn(note: NoteRecord, key: string) {
  switch (key) {
    case 'denomination':
      return note.denomination;
    case 'issueDate':
      return note.issueDate;
    case 'catalogNumber':
      return note.catalogNumber;
    case 'gradingCompany':
      return note.gradingCompany;
    case 'grade':
      return note.grade;
    case 'serial':
      return note.serial;
    case 'tags':
      return noteTagsLabel(note);
    case 'displayOrder':
      return `${note.displayOrder}`;
    default:
      return '';
  }
}

export function noteImageFor(note: NoteRecord, type: string, variant: string) {
  return note.images.find(
    (image) => image.type === type && image.variant === variant,
  );
}

export function notePreviewImage(note: NoteRecord, type: string) {
  return noteImageFor(note, type, 'thumbnail') ?? noteImageFor(note, type, 'full');
}

export function noteFullImage(note: NoteRecord, type: string) {
  return noteImageFor(note, type, 'full') ?? noteImageFor(note, type, 'thumbnail');
}
