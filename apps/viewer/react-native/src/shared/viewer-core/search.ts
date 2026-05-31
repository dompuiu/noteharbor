import type { NoteRecord, ParsedQuery } from './models';
import { noteTagsLabel, noteValueForColumn } from './models';

const fieldPattern =
  /\b(denomination|denom|date|catalog|cat|grading|company|grade|tag|tags):\s*/gi;

function canonicalField(keyword: string) {
  switch (keyword.toLowerCase()) {
    case 'denomination':
    case 'denom':
      return 'denomination';
    case 'date':
      return 'issueDate';
    case 'catalog':
    case 'cat':
      return 'catalogNumber';
    case 'company':
    case 'grading':
      return 'gradingCompany';
    case 'grade':
      return 'grade';
    case 'tag':
    case 'tags':
      return 'tags';
    default:
      return keyword;
  }
}

function splitSearchTerms(rawValue: string) {
  return Array.from(rawValue.trim().toLowerCase().matchAll(/\d(?:[\d,. ]*\d)?|[^\s]+/g))
    .map((match) => match[0] ?? '')
    .filter((value) => value.length > 0);
}

function normalizedDenominationAmount(value: string) {
  if (!/\d/.test(value)) {
    return null;
  }

  const normalized = value.replace(/[^\d]/g, '');
  return normalized.length > 0 ? normalized : null;
}

function denominationAmounts(value: string) {
  return Array.from(value.matchAll(/\d(?:[\d,. ]*\d)?/g))
    .map((match) => normalizedDenominationAmount(match[0] ?? ''))
    .filter((amount): amount is string => amount != null);
}

function matchesDenominationTerm(noteValue: string, term: string) {
  if (noteValue.includes(term)) {
    return true;
  }

  const normalizedAmount = normalizedDenominationAmount(term);
  if (normalizedAmount == null) {
    return false;
  }

  return denominationAmounts(noteValue).includes(normalizedAmount);
}

function matchesDenominationFilterValue(noteValue: string, filterValue: string) {
  const normalizedAmount = normalizedDenominationAmount(filterValue);
  if (normalizedAmount != null && !denominationAmounts(noteValue).includes(normalizedAmount)) {
    return false;
  }

  const textOnlyFilter = filterValue.replace(/\d(?:[\d,. ]*\d)?/g, ' ');
  const textTerms = splitSearchTerms(textOnlyFilter);
  return textTerms.every((term) => noteValue.includes(term));
}

function matchesAllFieldsSearch(note: NoteRecord, allFields: string) {
  const searchTerms = splitSearchTerms(allFields);
  if (searchTerms.length === 0) {
    return true;
  }

  const haystack = [
    `${note.displayOrder}`,
    note.denomination,
    note.issueDate,
    note.catalogNumber,
    note.gradingCompany,
    note.grade,
    note.serial,
    noteTagsLabel(note),
    note.notes,
  ]
    .join(' ')
    .toLowerCase();
  const denomination = note.denomination.toLowerCase();

  return searchTerms.every(
    (term) => haystack.includes(term) || matchesDenominationTerm(denomination, term),
  );
}

interface FilterToken {
  negated: boolean;
  value: string;
}

function parseFilterToken(rawValue: string, normalizeValue?: (value: string) => string): FilterToken | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const negated = normalized.startsWith('!');
  const parsedValue = negated ? normalized.substring(1).trim() : normalized;
  const value = normalizeValue ? normalizeValue(parsedValue) : parsedValue;
  if (!value) {
    return null;
  }

  return { negated, value };
}

function isAsciiDigit(character: string) {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isWhitespace(character: string) {
  return /\s/.test(character);
}

function isThousandsSeparator(rawValue: string, commaIndex: number) {
  if (commaIndex <= 0 || commaIndex + 1 >= rawValue.length) {
    return false;
  }

  if (!isAsciiDigit(rawValue[commaIndex - 1])) {
    return false;
  }

  if (isWhitespace(rawValue[commaIndex + 1])) {
    return false;
  }

  let nextIndex = commaIndex + 1;
  let digitCount = 0;
  while (nextIndex < rawValue.length && isAsciiDigit(rawValue[nextIndex])) {
    digitCount += 1;
    nextIndex += 1;
  }

  return digitCount === 3;
}

function isMonthDayYearDateComma(rawValue: string, commaIndex: number) {
  if (commaIndex <= 0 || commaIndex + 1 >= rawValue.length) {
    return false;
  }

  let previousEnd = commaIndex;
  while (previousEnd > 0 && isWhitespace(rawValue[previousEnd - 1])) {
    previousEnd -= 1;
  }

  let previousStart = previousEnd;
  while (previousStart > 0 && !isWhitespace(rawValue[previousStart - 1])) {
    previousStart -= 1;
  }

  const previousToken = rawValue.slice(previousStart, previousEnd);
  if (!/^\d{1,2}$/.test(previousToken)) {
    return false;
  }

  let nextStart = commaIndex + 1;
  while (nextStart < rawValue.length && isWhitespace(rawValue[nextStart])) {
    nextStart += 1;
  }

  let nextEnd = nextStart;
  while (nextEnd < rawValue.length && isAsciiDigit(rawValue[nextEnd])) {
    nextEnd += 1;
  }

  const nextToken = rawValue.slice(nextStart, nextEnd);
  return /^\d{4}$/.test(nextToken);
}

function isMultiValueSeparator(rawValue: string, commaIndex: number) {
  return !isThousandsSeparator(rawValue, commaIndex) && !isMonthDayYearDateComma(rawValue, commaIndex);
}

function splitFilterValues(rawValue: string) {
  const values: string[] = [];
  let buffer = '';

  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (character === ',' && isMultiValueSeparator(rawValue, index)) {
      values.push(buffer);
      buffer = '';
      continue;
    }

    buffer += character;
  }

  values.push(buffer);
  return values;
}

function parseMultiValueFilter(rawValue: string, normalizeValue?: (value: string) => string) {
  return splitFilterValues(rawValue)
    .map((value) => parseFilterToken(value, normalizeValue))
    .filter((value): value is FilterToken => value != null);
}

function matchesCatalogFilterValue(noteValue: string, filterValue: string) {
  if (!noteValue.startsWith(filterValue)) {
    return false;
  }

  if (noteValue.length === filterValue.length) {
    return true;
  }

  const nextCharacter = noteValue.substring(filterValue.length, filterValue.length + 1);
  return Number.isNaN(Number.parseInt(nextCharacter, 10));
}

function matchesScalarFilter(
  noteValue: string,
  rawFilterValue: string,
  multiple: boolean,
  matcher: (noteValue: string, filterValue: string) => boolean,
  normalizeValue?: (value: string) => string,
) {
  const filters = multiple
    ? parseMultiValueFilter(rawFilterValue, normalizeValue)
    : [parseFilterToken(rawFilterValue, normalizeValue)].filter((value): value is FilterToken => value != null);

  if (filters.length === 0) {
    return true;
  }

  const positiveFilters = filters.filter((filter) => !filter.negated);
  const negativeFilters = filters.filter((filter) => filter.negated);

  if (positiveFilters.length > 0) {
    const hasPositiveMatch = positiveFilters.some((filter) => matcher(noteValue, filter.value));
    if (!hasPositiveMatch) {
      return false;
    }
  }

  return negativeFilters.every((filter) => !matcher(noteValue, filter.value));
}

function matchesTagFilter(note: NoteRecord, rawFilterValue: string) {
  const filters = parseMultiValueFilter(rawFilterValue);
  if (filters.length === 0) {
    return true;
  }

  const noteTags = new Set(note.tags.map((tag) => tag.name.trim().toLowerCase()).filter((name) => name.length > 0));
  return filters.every((filter) => {
    const hasTag = noteTags.has(filter.value);
    return filter.negated ? !hasTag : hasTag;
  });
}

export function parseViewerQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { allFields: '', fields: {} };
  }

  const matches = Array.from(trimmed.matchAll(fieldPattern));
  if (matches.length === 0) {
    return { allFields: trimmed.toLowerCase(), fields: {} };
  }

  const fields: Record<string, string> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const canonical = canonicalField(match[1]);
    const valueStart = match.index! + match[0].length;
    const valueEnd = index + 1 < matches.length ? matches[index + 1].index! : trimmed.length;
    const segment = trimmed.slice(valueStart, valueEnd).trim();
    const value = segment.endsWith(',') ? segment.slice(0, -1).trim() : segment;
    if (value) {
      fields[canonical] = value;
    }
  }

  return {
    allFields: trimmed.slice(0, matches[0].index).trim().toLowerCase(),
    fields,
  };
}

export function filterViewerNotes(notes: NoteRecord[], query: string) {
  const parsed = parseViewerQuery(query);
  if (!parsed.allFields && Object.keys(parsed.fields).length === 0) {
    return [...notes];
  }

  return notes.filter((note) => {
    if (parsed.allFields && !matchesAllFieldsSearch(note, parsed.allFields)) {
      return false;
    }

    for (const [field, rawFilterValue] of Object.entries(parsed.fields)) {
      if (field === 'tags') {
        if (!matchesTagFilter(note, rawFilterValue)) {
          return false;
        }
        continue;
      }

      const fieldValue = noteValueForColumn(note, field).toLowerCase();
      const multiple = field === 'catalogNumber' || field === 'grade' || field === 'issueDate' || field === 'denomination';
      const matches = matchesScalarFilter(
        fieldValue,
        rawFilterValue,
        multiple,
        field === 'catalogNumber'
          ? matchesCatalogFilterValue
          : field === 'denomination'
            ? matchesDenominationFilterValue
            : (value, filterValue) => value.includes(filterValue),
      );

      if (!matches) {
        return false;
      }
    }

    return true;
  });
}

export function sortViewerNotes(
  notes: NoteRecord[],
  key: string,
  ascending: boolean,
) {
  const direction = ascending ? 1 : -1;
  return [...notes].sort((left, right) => {
    const leftValue = noteValueForColumn(left, key).toLowerCase();
    const rightValue = noteValueForColumn(right, key).toLowerCase();

    if (key === 'displayOrder') {
      return (left.displayOrder - right.displayOrder) * direction;
    }

    return leftValue.localeCompare(rightValue, undefined, { numeric: true }) * direction;
  });
}
