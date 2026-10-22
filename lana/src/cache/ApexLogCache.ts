/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { FileType, workspace, type Uri } from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { errorMessage } from '../tryCatch.js';

// The longest an org keeps any log (monitoring logs); a cached copy past it has no source.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_DELAY_MS = 10_000;
const NO_ORG = 'no-org';

export interface CacheSize {
  count: number;
  bytes: number;
}

/**
 * Apex log bodies downloaded only to search them. They live in VS Code's storage for this
 * workspace, one folder per org, never in the project. A log the user opens is written to the
 * project separately.
 */
export class ApexLogCache {
  private readonly root: Uri;

  constructor(storage: Uri) {
    this.root = Utils.joinPath(storage, 'apex-logs');
  }

  static for(context: Context): ApexLogCache {
    return new ApexLogCache(context.context.storageUri ?? context.context.globalStorageUri);
  }

  /** Prunes stale logs shortly after start-up, so a workspace left unused does not keep them. */
  static apply(context: Context): void {
    const timer = setTimeout(() => {
      ApexLogCache.for(context)
        .pruneByAge()
        .catch((error: unknown) =>
          context.display.output(`Unable to prune the Apex log cache: ${errorMessage(error)}`),
        );
    }, PRUNE_DELAY_MS);
    context.context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }

  uri(orgId: string | undefined, logId: string): Uri {
    return Utils.joinPath(this.folder(orgId), `${logId}.log`);
  }

  /**
   * The cached log Ids for an org. With `inOrg`, a cached log the org no longer lists is
   * deleted and left out.
   */
  async logIds(orgId: string | undefined, inOrg?: Set<string>): Promise<Set<string>> {
    const cachedIds = await logIdsIn(this.folder(orgId));
    if (!inOrg) {
      return new Set(cachedIds);
    }
    // Not awaited: deleting many large logs must not hold back the list.
    cachedIds
      .filter((logId) => !inOrg.has(logId))
      .forEach((logId) => void deleteQuietly(this.uri(orgId, logId)));
    return new Set(cachedIds.filter((logId) => inOrg.has(logId)));
  }

  async write(orgId: string | undefined, logId: string, body: string): Promise<void> {
    await workspace.fs.writeFile(this.uri(orgId, logId), new TextEncoder().encode(body));
  }

  async read(orgId: string | undefined, logId: string): Promise<Uint8Array> {
    return workspace.fs.readFile(this.uri(orgId, logId));
  }

  async size(): Promise<CacheSize> {
    const files = await this.files();
    return { count: files.length, bytes: files.reduce((total, file) => total + file.size, 0) };
  }

  /** Deletes the cached logs of one org, or of every org when `orgId` is omitted. */
  async clear(orgId?: string): Promise<void> {
    const target = orgId === undefined ? this.root : this.folder(orgId);
    await workspace.fs.delete(target, { recursive: true }).then(undefined, () => undefined);
  }

  async pruneByAge(now = Date.now()): Promise<void> {
    const files = await this.files();
    await Promise.all(
      files.filter((file) => now - file.mtime > MAX_AGE_MS).map((file) => deleteQuietly(file.uri)),
    );
  }

  private folder(orgId: string | undefined): Uri {
    return Utils.joinPath(this.root, orgId ?? NO_ORG);
  }

  private async files(): Promise<Array<{ uri: Uri; size: number; mtime: number }>> {
    const folders = (await entries(this.root))
      .filter(([, type]) => type === FileType.Directory)
      .map(([name]) => Utils.joinPath(this.root, name));
    const uris = (
      await Promise.all(
        folders.map(async (folder) =>
          (await logIdsIn(folder)).map((logId) => Utils.joinPath(folder, `${logId}.log`)),
        ),
      )
    ).flat();
    return Promise.all(
      uris.map(async (uri) => {
        const { size, mtime } = await workspace.fs.stat(uri);
        return { uri, size, mtime };
      }),
    );
  }
}

/** The log Ids of the `*.log` files in a folder; a missing folder has none. */
export async function logIdsIn(folder: Uri): Promise<string[]> {
  return (await entries(folder))
    .map(([name]) => name)
    .filter((name) => name.endsWith('.log'))
    .map((name) => name.slice(0, -'.log'.length));
}

async function entries(folder: Uri): Promise<[string, FileType][]> {
  return workspace.fs.readDirectory(folder).then(undefined, () => []);
}

async function deleteQuietly(uri: Uri): Promise<void> {
  await workspace.fs.delete(uri).then(undefined, () => undefined);
}
