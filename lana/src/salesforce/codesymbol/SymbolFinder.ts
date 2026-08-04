/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import type { Uri } from 'vscode';
import { workspace } from 'vscode';
import { Item, Options, QuickPick } from '../../display/QuickPick.js';
import type { VSWorkspace } from '../../workspace/VSWorkspace.js';
import type { ApexSymbol } from './ApexSymbolParser.js';

export type SymbolFindResult =
  { status: 'found'; uri: Uri } | { status: 'not-found' } | { status: 'cancelled' };

class ClassItem extends Item {
  uri: Uri;

  constructor(uri: Uri, className: string) {
    super(className, workspace.asRelativePath(uri), '');
    this.uri = uri;
  }
}

/**
 * Search the workspace index for each candidate in rank order; the first
 * candidate with a match wins. Multiple matches ask the user to pick, and
 * dismissing the picker is reported as cancelled, not as a miss.
 *
 * Namespace filtering belongs to `VSWorkspace.findClass`: every folder is
 * searched, and folders without the candidate's namespace contribute nothing.
 */
export async function findSymbol(
  workspaceFolders: VSWorkspace[],
  candidates: ApexSymbol[],
): Promise<SymbolFindResult> {
  for (const apexSymbol of candidates) {
    const uris = dedupeUris(workspaceFolders.flatMap((folder) => folder.findClass(apexSymbol)));

    if (!uris.length) {
      continue;
    }

    if (uris.length === 1) {
      return { status: 'found', uri: uris[0]! };
    }

    const selected = await QuickPick.pick(
      uris.map((uri) => new ClassItem(uri, apexSymbol.outerClass)),
      new Options('Select a class:'),
    );

    return selected.length ? { status: 'found', uri: selected[0]!.uri } : { status: 'cancelled' };
  }

  return { status: 'not-found' };
}

/** Overlapping package directories can index the same file twice. */
function dedupeUris(uris: Uri[]): Uri[] {
  const urisByKey = new Map<string, Uri>();
  for (const uri of uris) {
    const key = uri.toString();
    if (!urisByKey.has(key)) {
      urisByKey.set(key, uri);
    }
  }
  return [...urisByKey.values()];
}
