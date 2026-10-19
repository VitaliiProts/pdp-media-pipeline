import { TEST_DUB } from '../../../test/dub-fixtures';
import { currentRowId, transcriptOf } from './transcript';

describe('transcript', () => {
  it('interleaves phrases and unrecognised voice by time, with the marks the stats count', () => {
    const rows = transcriptOf(TEST_DUB);
    expect(rows.map((row) => [row.id, row.kind === 'phrase' ? row.marks : 'gap'])).toEqual([
      ['p1', []],
      ['p2', ['sped', 'refitted']],
      ['p3', ['sped', 'refitted', 'overflowed']],
      ['gap-0', 'gap'],
    ]);
    const marks = rows.flatMap((row) => (row.kind === 'phrase' ? row.marks : []));
    expect(marks.filter((m) => m === 'sped')).toHaveLength(TEST_DUB.stats.sped);
    expect(marks.filter((m) => m === 'refitted')).toHaveLength(TEST_DUB.stats.refitted);
    expect(marks.filter((m) => m === 'overflowed')).toHaveLength(TEST_DUB.stats.overflowed);
  });

  it('knows which row is heard, by the original or the dubbed timing', () => {
    const rows = transcriptOf(TEST_DUB);
    expect(currentRowId(rows, 0.2)).toBeNull();
    expect(currentRowId(rows, 1)).toBe('p1');
    expect(currentRowId(rows, 3)).toBeNull();
    expect(currentRowId(rows, 6.05)).toBe('p2');
    expect(currentRowId(rows, 6.3)).toBe('p3');
    // The overflowing dub of p3 still speaks over the unrecognised voice.
    expect(currentRowId(rows, 8.5)).toBe('gap-0');
    expect(currentRowId(rows, 11)).toBe('p3');
  });
});
