/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  findSnippet,
  searchLogContent,
  type ContentMatch,
  type LogSearchOptions,
  type LogStore,
  type SearchableLog,
} from '../LogContentSearch.js';

const MB = 1024 * 1024;

const log = (id: string, LogLength = 1024, StartTime = '2024-01-01T00:00:00.000Z') =>
  ({ Id: id, LogLength, StartTime }) satisfies SearchableLog;

function fakeStore(cached: Record<string, string>, remote: Record<string, string> = {}) {
  const files = new Map(Object.entries(cached));
  const calls: string[] = [];
  const store: LogStore = {
    has: (id) => files.has(id),
    read: async (id) => {
      calls.push(`read:${id}`);
      return new TextEncoder().encode(files.get(id));
    },
    download: async (id) => {
      calls.push(`download:${id}`);
      return remote[id] ?? '';
    },
    write: async (id, body) => {
      files.set(id, body);
    },
  };
  return { store, calls, files };
}

function options(overrides: Partial<LogSearchOptions> = {}) {
  const matches: ContentMatch[] = [];
  const errors: string[] = [];
  const opts: LogSearchOptions = {
    signal: new AbortController().signal,
    onMatch: (match) => matches.push(match),
    onProgress: () => undefined,
    onError: (logId) => errors.push(logId),
    ...overrides,
  };
  return { opts, matches, errors };
}

describe('findSnippet', () => {
  it('returns undefined when there is no match', () => {
    expect(findSnippet('nothing here', 'cpu')).toBeUndefined();
  });

  it('matches case-insensitively and keeps the source case', () => {
    expect(findSnippet('System.LimitException: Apex CPU time limit', 'cpu time')).toBe(
      'System.LimitException: Apex CPU time limit',
    );
  });

  it('cuts long text to 40 characters each side, with an ellipsis on each cut end', () => {
    const text = `${'a'.repeat(100)}MATCH${'b'.repeat(100)}`;
    expect(findSnippet(text, 'match')).toBe(`…${'a'.repeat(40)}MATCH${'b'.repeat(40)}…`);
  });

  it('puts the snippet on one line', () => {
    expect(findSnippet('line one\r\n\tERROR here\nnext', 'error')).toBe('line one ERROR here next');
  });

  it('treats regex characters in the term as text', () => {
    expect(findSnippet('call foo(1) done', 'foo(1)')).toBe('call foo(1) done');
    expect(findSnippet('call foo1 done', 'foo.')).toBeUndefined();
  });
});

describe('searchLogContent', () => {
  it('reports the first match in each log, cached or downloaded, and caches the download', async () => {
    const { store, files } = fakeStore(
      { cached: 'cached has FATAL_ERROR' },
      { remote: 'remote has fatal_error too', other: 'clean' },
    );
    const { opts, matches } = options();

    await searchLogContent(
      [log('cached'), log('remote'), log('other')],
      'fatal_error',
      store,
      opts,
    );

    expect(matches.map((m) => m.logId).sort()).toEqual(['cached', 'remote']);
    expect(files.get('remote')).toBe('remote has fatal_error too');
    expect(files.get('other')).toBe('clean');
  });

  it('finds a match split across two decode chunks of a cached file', async () => {
    const body = `${'x'.repeat(4 * MB - 3)}NEEDLE${'y'.repeat(10)}`;
    const { store } = fakeStore({ big: body });
    const { opts, matches } = options();

    await searchLogContent([log('big', body.length)], 'needle', store, opts);

    expect(matches).toEqual([
      { logId: 'big', snippet: `…${'x'.repeat(40)}NEEDLE${'y'.repeat(10)}` },
    ]);
  });

  // A log with an error in it is often larger, so a size order would search it last.
  it('searches cached logs first, then the rest newest first whatever their size', async () => {
    const { store, calls } = fakeStore({ cached: '' });
    const { opts } = options();
    const logs = [
      log('old-small', 10, '2024-01-01T00:00:00.000Z'),
      log('cached', 10, '2023-01-01T00:00:00.000Z'),
      log('new-large', 90 * MB, '2024-02-01T00:00:00.000Z'),
      log('mid', 18 * MB, '2024-01-15T00:00:00.000Z'),
    ];

    await searchLogContent(logs, 'term', store, opts);

    expect(calls).toEqual([
      'read:cached',
      'download:new-large',
      'download:mid',
      'download:old-small',
    ]);
  });

  it.each([
    ['keeps at most 100 MB in flight', { a: 60 * MB, b: 60 * MB }, 60 * MB],
    ['runs a log over 100 MB alone', { big: 150 * MB, small: 1 }, 150 * MB],
  ])('%s', async (_name, sizes: Record<string, number>, expectedPeak) => {
    let inFlight = 0;
    let peak = 0;
    const store: LogStore = {
      has: () => false,
      read: async () => new Uint8Array(),
      download: async (id) => {
        inFlight += sizes[id] ?? 0;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= sizes[id] ?? 0;
        return '';
      },
      write: async () => undefined,
    };
    const { opts } = options();

    await searchLogContent(
      Object.entries(sizes).map(([id, size]) => log(id, size)),
      'term',
      store,
      opts,
    );

    expect(peak).toBe(expectedPeak);
  });

  it('runs small logs in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const store: LogStore = {
      has: () => false,
      read: async () => new Uint8Array(),
      download: async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return '';
      },
      write: async () => undefined,
    };
    const { opts } = options();

    await searchLogContent([log('a'), log('b'), log('c')], 'term', store, opts);

    expect(peak).toBe(3);
  });

  it('starts no new log and reports no match after an abort, but caches a running download', async () => {
    const cancellation = new AbortController();
    let release: (body: string) => void = () => undefined;
    const files = new Map<string, string>();
    const started: string[] = [];
    const store: LogStore = {
      has: (id) => files.has(id),
      read: async () => new Uint8Array(),
      download: (id) => {
        started.push(id);
        return new Promise((resolve) => (release = resolve));
      },
      write: async (id, body) => {
        files.set(id, body);
      },
    };
    const { opts, matches } = options({ signal: cancellation.signal });

    const running = searchLogContent([log('a', 60 * MB), log('b', 60 * MB)], 'term', store, opts);
    await new Promise((resolve) => setImmediate(resolve));
    cancellation.abort();
    release('term');
    await running;

    expect(started).toEqual(['a']);
    expect(files.get('a')).toBe('term');
    expect(matches).toEqual([]);
  });

  it('reports a failed log and carries on with the rest', async () => {
    const { store } = fakeStore({}, { ok: 'term' });
    store.download = async (id) => {
      if (id === 'denied') {
        throw new Error('Salesforce denied access');
      }
      return 'term';
    };
    const { opts, matches, errors } = options();

    await searchLogContent([log('denied'), log('ok')], 'term', store, opts);

    expect(errors).toEqual(['denied']);
    expect(matches.map((m) => m.logId)).toEqual(['ok']);
  });

  it('reports progress over the logs it searches', async () => {
    const { store } = fakeStore({ a: '', b: '' });
    const progress: string[] = [];
    const { opts } = options({
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });

    await searchLogContent([log('a'), log('b')], 'term', store, opts);

    expect(progress).toEqual(['0/2', '1/2', '2/2']);
  });

  it('reports a downloaded match even when the cache write fails', async () => {
    const { store } = fakeStore({}, { a: 'term' });
    store.write = async () => {
      throw new Error('read-only workspace');
    };
    const { opts, matches, errors } = options();

    await searchLogContent([log('a')], 'term', store, opts);

    expect(matches.map((m) => m.logId)).toEqual(['a']);
    expect(errors).toEqual(['a']);
  });

  it('runs at most 8 logs at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const store: LogStore = {
      has: () => false,
      read: async () => new Uint8Array(),
      download: async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return '';
      },
      write: async () => undefined,
    };
    const { opts } = options();

    await searchLogContent(
      Array.from({ length: 20 }, (_, i) => log(`log-${i}`)),
      'term',
      store,
      opts,
    );

    expect(peak).toBe(8);
  });
});
