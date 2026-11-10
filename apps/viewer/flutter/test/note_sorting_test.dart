import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/table/note_sorting.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  group('denomination', () {
    test('sorts by numeric amount, not by string', () {
      final notes = [
        note(id: 1, denomination: '1,000 Lei'),
        note(id: 2, denomination: '100 Lei'),
        note(id: 3, denomination: '20 Lei'),
        note(id: 4, denomination: '5 Lei'),
        note(id: 5, denomination: '24 Lei'),
        note(id: 6, denomination: '500 Lei'),
      ];

      expect(denominations(notes, ascending: true), [
        '5 Lei',
        '20 Lei',
        '24 Lei',
        '100 Lei',
        '500 Lei',
        '1,000 Lei',
      ]);
      expect(denominations(notes, ascending: false), [
        '1,000 Lei',
        '500 Lei',
        '100 Lei',
        '24 Lei',
        '20 Lei',
        '5 Lei',
      ]);
    });

    test('separates equal amounts by currency name', () {
      final notes = [
        note(id: 1, denomination: '10 Lei'),
        note(id: 2, denomination: '10 Bani'),
      ];

      expect(denominations(notes, ascending: true), ['10 Bani', '10 Lei']);
    });
  });

  group('catalog', () {
    test('sorts families naturally', () {
      final notes = [
        note(id: 1, catalogNumber: 'M10'),
        note(id: 2, catalogNumber: 'M6'),
        note(id: 3, catalogNumber: 'M22a'),
        note(id: 4, catalogNumber: 'M7'),
        note(id: 5, catalogNumber: 'M8'),
        note(id: 6, catalogNumber: 'M22'),
        note(id: 7, catalogNumber: 'M1'),
        note(id: 8, catalogNumber: 'M2'),
      ];

      expect(catalogs(notes, ascending: true), [
        'M1',
        'M2',
        'M6',
        'M7',
        'M8',
        'M10',
        'M22',
        'M22a',
      ]);
      expect(catalogs(notes, ascending: false), [
        'M22a',
        'M22',
        'M10',
        'M8',
        'M7',
        'M6',
        'M2',
        'M1',
      ]);
    });

    test('keeps a family together before the next base number', () {
      final notes = [
        note(id: 1, catalogNumber: '22b'),
        note(id: 2, catalogNumber: '220'),
        note(id: 3, catalogNumber: '22'),
        note(id: 4, catalogNumber: '22a'),
        note(id: 5, catalogNumber: '221'),
      ];

      // The same family rule as the catalog filter: 22, 22a, and 22b are one
      // family; 220 and 221 are the next ones, not variants of 22.
      expect(catalogs(notes, ascending: true), [
        '22',
        '22a',
        '22b',
        '220',
        '221',
      ]);
    });
  });

  group('issue date', () {
    test('sorts chronologically and groups approximate dates by year', () {
      final notes = [
        note(id: 1, issueDate: '09/10/1941'),
        note(id: 2, issueDate: '03/01/5/1934'),
        note(id: 3, issueDate: '1941-44'),
        note(id: 4, issueDate: '01/15/1915'),
        note(id: 5, issueDate: '1966'),
        note(id: 6, issueDate: 'ND (1941-44)'),
        note(id: 7, issueDate: '1941'),
        note(id: 8, issueDate: ''),
      ];

      expect(dates(notes, ascending: true), [
        '01/15/1915',
        '1941',
        '1941-44',
        'ND (1941-44)',
        '09/10/1941',
        '1966',
        // Unparseable values keep a string order after every parsed date.
        '',
        '03/01/5/1934',
      ]);
      expect(dates(notes, ascending: false), [
        '03/01/5/1934',
        '',
        '1966',
        '09/10/1941',
        'ND (1941-44)',
        '1941-44',
        '1941',
        '01/15/1915',
      ]);
    });
  });

  group('grade', () {
    test('sorts by number with the paper-quality qualifier as tiebreaker', () {
      final notes = [
        note(id: 1, grade: '66 EPQ'),
        note(id: 2, grade: '66'),
        note(id: 3, grade: '66 NET'),
        note(id: 4, grade: '66 PPQ'),
        note(id: 5, grade: '68 EPQ'),
        note(id: 6, grade: '70 EPQ*'),
        note(id: 7, grade: '15 NET'),
      ];

      expect(grades(notes, ascending: true), [
        '15 NET',
        '66 NET',
        '66',
        '66 PPQ',
        '66 EPQ',
        '68 EPQ',
        '70 EPQ*',
      ]);
    });
  });

  test('equal keys keep the collection order in both directions', () {
    final notes = [
      note(id: 1, displayOrder: 2, denomination: '5 Lei'),
      note(id: 2, displayOrder: 1, denomination: '5 Lei'),
    ];

    expect(
      sortNotes(
        notes,
        column: 'denomination',
        ascending: true,
      ).map((note) => note.id),
      [2, 1],
    );
    expect(
      sortNotes(
        notes,
        column: 'denomination',
        ascending: false,
      ).map((note) => note.id),
      [2, 1],
    );
  });

  test('sorting never drops rows', () {
    final notes = [
      note(id: 1, issueDate: 'not a date'),
      note(id: 2, denomination: ''),
      note(id: 3, grade: 'ungraded'),
      note(id: 4, catalogNumber: ''),
    ];

    expect(
      sortNotes(notes, column: 'issueDate', ascending: true),
      hasLength(4),
    );
    expect(
      sortNotes(notes, column: 'catalogNumber', ascending: true),
      hasLength(4),
    );
  });
}

List<String> denominations(List<NoteRecord> notes, {required bool ascending}) =>
    sortNotes(
      notes,
      column: 'denomination',
      ascending: ascending,
    ).map((note) => note.denomination).toList();

List<String> catalogs(List<NoteRecord> notes, {required bool ascending}) =>
    sortNotes(
      notes,
      column: 'catalogNumber',
      ascending: ascending,
    ).map((note) => note.catalogNumber).toList();

List<String> dates(List<NoteRecord> notes, {required bool ascending}) =>
    sortNotes(
      notes,
      column: 'issueDate',
      ascending: ascending,
    ).map((note) => note.issueDate).toList();

List<String> grades(List<NoteRecord> notes, {required bool ascending}) =>
    sortNotes(
      notes,
      column: 'grade',
      ascending: ascending,
    ).map((note) => note.grade).toList();

NoteRecord note({
  required int id,
  int displayOrder = 0,
  String denomination = '',
  String issueDate = '',
  String catalogNumber = '',
  String grade = '',
}) {
  return NoteRecord(
    id: id,
    collectionId: 1,
    displayOrder: displayOrder == 0 ? id : displayOrder,
    denomination: denomination,
    issueDate: issueDate,
    catalogNumber: catalogNumber,
    gradingCompany: '',
    grade: grade,
    watermark: '',
    serial: '',
    url: '',
    notes: '',
    scrapeStatus: '',
    scrapeError: '',
    tags: const [],
    images: const [],
    scrapedData: null,
  );
}
