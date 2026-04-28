import minMaxFilter, { minMaxTreeFilter } from '../MinMax.js';

const NS = 1_000_000;

describe('minMaxFilter (core, non-recursive)', () => {
  it('matches when value is within [start, end] (ms)', () => {
    expect(minMaxFilter({ start: 1, end: 10 }, 5 * NS)).toBe(true);
  });

  it('rejects when value is below start', () => {
    expect(minMaxFilter({ start: 5, end: null }, 1 * NS)).toBe(false);
  });

  it('rejects when value is above end', () => {
    expect(minMaxFilter({ start: null, end: 5 }, 10 * NS)).toBe(false);
  });

  it('passes everything when both bounds are null', () => {
    expect(minMaxFilter({ start: null, end: null }, 0)).toBe(true);
  });

  it('does NOT recurse into _children', () => {
    // even if a descendant would match, the row itself must match
    const row = { _children: [{ totalTime: 5 * NS }], totalTime: 0, id: 1 };
    // core filter takes only filterVal + rowVal; passing rowVal=0 → out of [1,10]
    expect(minMaxFilter({ start: 1, end: 10 }, row.totalTime)).toBe(false);
  });
});

describe('minMaxTreeFilter (recursive)', () => {
  it('matches a row when its own value is in range', () => {
    const cache = new Map<number, boolean>();
    const row = { id: 1, totalTime: 5 * NS };
    expect(
      minMaxTreeFilter({ start: 1, end: 10 }, row.totalTime, row, {
        columnName: 'totalTime',
        filterCache: cache,
      }),
    ).toBe(true);
  });

  it('matches a parent whose own value is out of range but a child is in range', () => {
    const cache = new Map<number, boolean>();
    const child = { id: 2, totalTime: 5 * NS };
    const parent = { id: 1, totalTime: 0, _children: [child] };
    expect(
      minMaxTreeFilter({ start: 1, end: 10 }, parent.totalTime, parent, {
        columnName: 'totalTime',
        filterCache: cache,
      }),
    ).toBe(true);
  });

  it('rejects when neither row nor descendants match', () => {
    const cache = new Map<number, boolean>();
    const child = { id: 2, totalTime: 0 };
    const parent = { id: 1, totalTime: 0, _children: [child] };
    expect(
      minMaxTreeFilter({ start: 1, end: 10 }, parent.totalTime, parent, {
        columnName: 'totalTime',
        filterCache: cache,
      }),
    ).toBe(false);
  });

  it('supports dotted column paths (e.g. duration.self)', () => {
    const cache = new Map<number, boolean>();
    const child = { id: 2, duration: { total: 0, self: 5 * NS } };
    const parent = { id: 1, duration: { total: 0, self: 0 }, _children: [child] };
    expect(
      minMaxTreeFilter({ start: 1, end: 10 }, parent.duration.self, parent, {
        columnName: 'duration.self',
        filterCache: cache,
      }),
    ).toBe(true);
  });
});
