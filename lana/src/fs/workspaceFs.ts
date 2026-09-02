/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { workspace, type Uri } from 'vscode';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Reads a file as UTF-8 text.
 *
 * One decode pass, one string: no normalisation and no intermediate copy, so a
 * multi-hundred-MB log does not double its peak memory here.
 */
export async function readFileText(uri: Uri): Promise<string> {
  return decoder.decode(await workspace.fs.readFile(uri));
}

export async function writeFileText(uri: Uri, content: string): Promise<void> {
  await workspace.fs.writeFile(uri, encoder.encode(content));
}

/**
 * `workspace.fs` has no `exists`, so `stat` is the idiom. Any failure — missing,
 * unreadable, or no provider for the scheme — answers the question every caller
 * is really asking: can this be read?
 */
export async function fileOrFolderExists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
