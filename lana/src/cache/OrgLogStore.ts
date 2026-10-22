/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { workspace, type Uri } from 'vscode';
import { Utils } from 'vscode-uri';

import type { LogStore, SearchableLog } from '../commands/LogContentSearch.js';
import { readFileText } from '../fs/workspaceFs.js';
import { logIdsIn, type ApexLogCache, type CacheSize } from './ApexLogCache.js';

export interface OrgLogStoreOptions {
  cache: ApexLogCache;
  orgId: string | undefined;
  workspaceFolder: Uri;
  /** The org's log list; cached logs it no longer has are left out, and deleted from the cache. */
  logs: SearchableLog[];
  download(logId: string): Promise<string>;
}

/**
 * The logs of one org that can be read without a download: those the user opened, in the
 * project, and those downloaded only for search, in the search cache.
 */
export class OrgLogStore implements LogStore {
  private readonly options: OrgLogStoreOptions;
  private readonly openedFolder: Uri;
  private readonly openedIds: Set<string>;
  private readonly searchIds: Set<string>;
  private readonly logLengths: Map<string, number>;

  private constructor(
    options: OrgLogStoreOptions,
    openedFolder: Uri,
    openedIds: Set<string>,
    searchIds: Set<string>,
  ) {
    this.options = options;
    this.openedFolder = openedFolder;
    this.openedIds = openedIds;
    this.searchIds = searchIds;
    this.logLengths = new Map(options.logs.map((log) => [log.Id, log.LogLength]));
  }

  static async open(options: OrgLogStoreOptions): Promise<OrgLogStore> {
    const { cache, orgId, logs } = options;
    const openedFolder = Utils.joinPath(
      options.workspaceFolder,
      '.sfdx',
      'tools',
      'debug',
      'logs',
      ...(orgId ? [orgId] : []),
    );
    const inOrg = new Set(logs.map((log) => log.Id));
    if (orgId) {
      // Not awaited: deleting many large logs must not hold back the list.
      void cache.pruneNotIn(orgId, inOrg);
    }
    const [openedIds, searchIds] = await Promise.all([logIdsIn(openedFolder), cache.logIds(orgId)]);
    return new OrgLogStore(
      options,
      openedFolder,
      new Set(openedIds.filter((logId) => inOrg.has(logId))),
      new Set(orgId ? [...searchIds].filter((logId) => inOrg.has(logId)) : searchIds),
    );
  }

  has(logId: string): boolean {
    return this.openedIds.has(logId) || this.searchIds.has(logId);
  }

  read(logId: string): Promise<Uint8Array> {
    return this.openedIds.has(logId)
      ? Promise.resolve(workspace.fs.readFile(this.openedUri(logId)))
      : this.options.cache.read(this.options.orgId, logId);
  }

  download(logId: string): Promise<string> {
    return this.options.download(logId);
  }

  async write(logId: string, body: string): Promise<void> {
    await this.options.cache.write(this.options.orgId, logId, body);
    this.searchIds.add(logId);
  }

  isOpened(logId: string): boolean {
    return this.openedIds.has(logId);
  }

  /** Where a log the user opens is kept, in the project. */
  openedUri(logId: string): Uri {
    return Utils.joinPath(this.openedFolder, `${logId}.log`);
  }

  /** The body of a log to open: from the search cache when there, else downloaded. */
  async body(logId: string): Promise<string> {
    return this.searchIds.has(logId)
      ? readFileText(this.options.cache.uri(this.options.orgId, logId))
      : this.download(logId);
  }

  /** The logs downloaded only for search. */
  size(): CacheSize {
    return {
      count: this.searchIds.size,
      bytes: [...this.searchIds].reduce(
        (total, logId) => total + (this.logLengths.get(logId) ?? 0),
        0,
      ),
    };
  }

  async clear(): Promise<void> {
    await this.options.cache.clear(this.options.orgId);
    this.searchIds.clear();
  }
}
