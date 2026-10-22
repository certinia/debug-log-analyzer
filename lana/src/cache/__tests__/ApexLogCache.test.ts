/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { FileType, Uri, workspace } from 'vscode';

import { ApexLogCache } from '../ApexLogCache.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

/** A flat in-memory file system behind the `workspace.fs` mock; folders are implied by paths. */
function memoryFs() {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const fs = workspace.fs as unknown as Record<string, jest.Mock>;
  const missing = () => Promise.reject(new Error('ENOENT'));

  fs.writeFile?.mockImplementation(async (uri: Uri, data: Uint8Array) => {
    files.set(uri.path, { data, mtime: NOW });
  });
  fs.readFile?.mockImplementation(async (uri: Uri) => files.get(uri.path)?.data ?? missing());
  fs.stat?.mockImplementation(async (uri: Uri) => {
    const file = files.get(uri.path);
    return file ? { size: file.data.length, mtime: file.mtime } : missing();
  });
  fs.delete?.mockImplementation(async (uri: Uri) => {
    [...files.keys()]
      .filter((path) => path === uri.path || path.startsWith(`${uri.path}/`))
      .forEach((path) => files.delete(path));
  });
  fs.readDirectory?.mockImplementation(async (uri: Uri) => {
    const children = new Map<string, FileType>();
    for (const path of files.keys()) {
      if (path.startsWith(`${uri.path}/`)) {
        const [name = '', ...rest] = path.slice(uri.path.length + 1).split('/');
        children.set(name, rest.length > 0 ? FileType.Directory : FileType.File);
      }
    }
    return children.size > 0 ? [...children] : missing();
  });

  const put = (path: string, body: string, ageDays = 0) =>
    files.set(path, { data: new TextEncoder().encode(body), mtime: NOW - ageDays * DAY });
  return { files, put };
}

describe('ApexLogCache', () => {
  let fs: ReturnType<typeof memoryFs>;
  const cache = new ApexLogCache(Uri.file('/storage'));
  const root = '/storage/apex-logs';

  beforeEach(() => {
    fs = memoryFs();
  });

  it('writes and reads a log under its org, out of the project', async () => {
    await cache.write('00Dorg', '07L1', 'body');

    expect([...fs.files.keys()]).toEqual([`${root}/00Dorg/07L1.log`]);
    expect(new TextDecoder().decode(await cache.read('00Dorg', '07L1'))).toBe('body');
  });

  it('lists cached log Ids, and none for an org never cached', async () => {
    fs.put(`${root}/00Dorg/07L1.log`, 'a');
    fs.put(`${root}/00Dorg/notes.txt`, 'b');

    expect(await cache.logIds('00Dorg')).toEqual(new Set(['07L1']));
    expect(await cache.logIds('00Dother')).toEqual(new Set());
  });

  it('deletes cached logs the org no longer lists, and only for that org', async () => {
    fs.put(`${root}/00Dorg/kept.log`, 'a');
    fs.put(`${root}/00Dorg/gone.log`, 'b');
    fs.put(`${root}/00Dother/gone.log`, 'c');

    await cache.pruneNotIn('00Dorg', new Set(['kept']));

    expect([...fs.files.keys()].sort()).toEqual([
      `${root}/00Dorg/kept.log`,
      `${root}/00Dother/gone.log`,
    ]);
  });

  it('keeps logs of an unknown org in their own folder', async () => {
    await cache.write(undefined, '07L1', 'body');

    expect([...fs.files.keys()]).toEqual([`${root}/no-org/07L1.log`]);
  });

  it('deletes logs older than 7 days across every org', async () => {
    fs.put(`${root}/00Da/new.log`, 'a', 6);
    fs.put(`${root}/00Da/old.log`, 'b', 8);
    fs.put(`${root}/00Db/old.log`, 'c', 30);

    await cache.pruneByAge(NOW);

    expect([...fs.files.keys()]).toEqual([`${root}/00Da/new.log`]);
  });

  it('measures the whole cache', async () => {
    fs.put(`${root}/00Da/1.log`, 'abc');
    fs.put(`${root}/00Db/2.log`, 'de');

    expect(await cache.size()).toEqual({ count: 2, bytes: 5 });
  });

  it('clears one org, or every org', async () => {
    fs.put(`${root}/00Da/1.log`, 'a');
    fs.put(`${root}/00Db/2.log`, 'b');

    await cache.clear('00Da');
    expect([...fs.files.keys()]).toEqual([`${root}/00Db/2.log`]);

    await cache.clear();
    expect(fs.files.size).toBe(0);
  });

  it('treats a cache that was never written as empty', async () => {
    expect(await cache.size()).toEqual({ count: 0, bytes: 0 });
    await expect(cache.pruneByAge(NOW)).resolves.toBeUndefined();
  });
});
