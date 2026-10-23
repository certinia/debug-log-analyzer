/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Uri } from 'vscode';

import { memoryFs } from '../../__tests__/helpers/memoryFs.js';
import { asContext, createMockContext } from '../../__tests__/helpers/test-builders.js';
import { ApexLogCache } from '../ApexLogCache.js';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

describe('ApexLogCache', () => {
  let fs: ReturnType<typeof memoryFs>;
  const cache = new ApexLogCache(Uri.file('/storage'));
  const root = '/storage/apex-logs';

  beforeEach(() => {
    fs = memoryFs(NOW);
  });

  it('writes and reads a log under its org, out of the project', async () => {
    await cache.write('00Dorg', '07L1', 'body');

    expect(fs.paths()).toEqual([`${root}/00Dorg/07L1.log`]);
    expect(new TextDecoder().decode(await cache.read('00Dorg', '07L1'))).toBe('body');
  });

  it('lists cached log Ids, and none for an org never cached', async () => {
    fs.put(`${root}/00Dorg/07L1.log`, 'a');
    fs.put(`${root}/00Dorg/notes.txt`, 'b');

    expect(await cache.logIds('00Dorg')).toEqual(new Set(['07L1']));
    expect(await cache.logIds('00Dother')).toEqual(new Set());
  });

  it('keeps logs of an unknown org in their own folder', async () => {
    await cache.write(undefined, '07L1', 'body');

    expect(fs.paths()).toEqual([`${root}/no-org/07L1.log`]);
  });

  it('deletes logs older than 7 days across every org', async () => {
    fs.put(`${root}/00Da/new.log`, 'a', 6);
    fs.put(`${root}/00Da/old.log`, 'b', 8);
    fs.put(`${root}/00Db/old.log`, 'c', 30);

    await cache.pruneByAge(NOW);

    expect(fs.paths()).toEqual([`${root}/00Da/new.log`]);
  });

  it('prunes a cache that was never written without an error', async () => {
    await expect(cache.pruneByAge(NOW)).resolves.toBeUndefined();
  });

  it('clears one org, the unknown org alone, or every org', async () => {
    fs.put(`${root}/00Da/1.log`, 'a');
    fs.put(`${root}/00Db/2.log`, 'b');
    fs.put(`${root}/no-org/3.log`, 'c');

    await cache.clear('00Da');
    expect(fs.paths()).toEqual([`${root}/00Db/2.log`, `${root}/no-org/3.log`]);

    await cache.clear(undefined);
    expect(fs.paths()).toEqual([`${root}/00Db/2.log`]);

    await cache.clearAll();
    expect(fs.paths()).toEqual([]);
  });

  describe('at start-up', () => {
    const flush = async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      [false, []],
      [true, ['/test/storage/apex-logs/00Da/old.log']],
    ])(
      'deletes logs older than 7 days 10 s after activation, unless disposed first: %s',
      async (disposed, left) => {
        jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate'] });
        fs.put('/test/storage/apex-logs/00Da/old.log', 'a', 8);
        const context = createMockContext();
        ApexLogCache.apply(asContext(context));

        if (disposed) {
          context.context.subscriptions.forEach((subscription) => subscription.dispose());
        }
        jest.advanceTimersByTime(10_000);
        await flush();

        expect(fs.paths()).toEqual(left);
      },
    );
  });
});
