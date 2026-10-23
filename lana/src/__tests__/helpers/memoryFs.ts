/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { FileType, workspace, type Uri } from 'vscode';

const DAY = 24 * 60 * 60 * 1000;

/** A flat in-memory file system behind the `workspace.fs` mock; folders are implied by paths. */
export function memoryFs(now = Date.now()) {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const fs = workspace.fs as unknown as Record<string, jest.Mock>;
  const missing = () => Promise.reject(new Error('ENOENT'));

  fs.writeFile?.mockImplementation(async (uri: Uri, data: Uint8Array) => {
    files.set(uri.path, { data, mtime: now });
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
    files.set(path, { data: new TextEncoder().encode(body), mtime: now - ageDays * DAY });
  const paths = () => [...files.keys()].sort();
  return { files, put, paths };
}
