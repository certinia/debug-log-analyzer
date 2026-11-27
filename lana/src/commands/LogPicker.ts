/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ThemeIcon, window, type QuickInputButton, type QuickPickItem } from 'vscode';

import type { CacheSize } from '../cache/ApexLogCache.js';
import { megabytes, plural } from '../display/format.js';
import { Item } from '../display/QuickPick.js';
import { errorMessage } from '../tryCatch.js';
import {
  newestFirst,
  searchLogContent,
  type LogStore,
  type SearchableLog,
} from './LogContentSearch.js';

const SEARCH_DELAY_MS = 400;
const MIN_SEARCH_LENGTH = 3;
const REFRESH_DELAY_MS = 100;
const FIRST_DOWNLOADS = 5;
// Each log is one API call against the org's daily limit, so one press never costs more.
const MORE_DOWNLOADS = 50;

/** The fields of an Apex log list row the picker shows. */
export interface PickerLog extends SearchableLog {
  LogUser?: { Name?: string };
  Operation?: string;
  Status: string;
  DurationMilliseconds?: number;
}

interface LogPickerOptions {
  logs: PickerLog[];
  store: LogStore;
  placeholder: string;
  /** The search cache of this org; the title button offers to clear it. */
  cache: {
    size(): CacheSize;
    /** Asks first; resolves true when the cache was cleared. */
    clear(): Promise<boolean>;
  };
  output(message: string, show?: boolean): void;
}

class DebugLogItem extends Item {
  logId: string;
  private readonly logDescription: string;
  private readonly logDetail: string;

  constructor(name: string, desc: string, details: string, logId: string) {
    super(name, desc, details, false);
    this.logId = logId;
    this.logDescription = desc;
    this.logDetail = details;
  }

  showMatch(snippet: string): void {
    this.alwaysShow = true;
    this.description = `${this.logDescription} · ${this.logDetail}`;
    this.detail = snippet;
  }

  clearMatch(): void {
    this.alwaysShow = false;
    this.description = this.logDescription;
    this.detail = this.logDetail;
  }
}

/** One typed term: the logs still to search and how far the search has got. */
interface TermSearch {
  term: string;
  cancellation: AbortController;
  /** Logs not cached and not yet searched, newest first. */
  unsearched: PickerLog[];
  /** How many of `unsearched` belong to the newest logs; 0 once those are searched. */
  newestToDownload: number;
  searched: number;
  matches: number;
  /** Logs that could not be read or downloaded, until the next press retries them. */
  failed: Set<string>;
  running: number;
  /** Logs in the download batch now running; 0 when none runs. */
  downloading: number;
}

/**
 * Shows the org's logs, newest first, filtered on their metadata as the user types.
 *
 * Cached logs are also searched for the typed text after a pause. Nothing downloads until the
 * user picks the top row, which downloads whichever of the newest 5 logs are not cached, then
 * offers older logs 50 at a time. Resolves with the picked log Id, or undefined when dismissed.
 */
export function pickLog(options: LogPickerOptions): Promise<string | undefined> {
  const { logs, store } = options;
  const sorted = newestFirst(logs);
  const items = sorted.map(
    (log) =>
      new DebugLogItem(
        `${log.LogUser?.Name ?? 'Unknown user'} - ${log.Operation ?? 'Unknown operation'}`,
        `${(log.LogLength / 1024).toFixed(2)} KB ${formatDuration(log.DurationMilliseconds ?? 0)}`,
        `${new Date(log.StartTime).toLocaleString()} - ${log.Status} - ${log.Id}`,
        log.Id,
      ),
  );
  const itemsById = new Map(items.map((item) => [item.logId, item]));
  // Labelled with the exact term, so VS Code's prefix sort keeps it above every log row.
  const downloadIcon = new ThemeIcon('cloud-download');
  const searchRow: QuickPickItem = {
    label: '',
    iconPath: downloadIcon,
    alwaysShow: true,
  };
  const newest = Math.min(FIRST_DOWNLOADS, logs.length);
  const newestIds = new Set(sorted.slice(0, newest).map((log) => log.Id));
  let clearButton: QuickInputButton | undefined;
  let search: TermSearch | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let queuedRefresh: ReturnType<typeof setTimeout> | undefined;

  const picker = window.createQuickPick<QuickPickItem>();
  picker.placeholder = options.placeholder;
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  picker.keepScrollPosition = true;

  const showsSearchRow = () =>
    search !== undefined && (search.unsearched.length > 0 || search.downloading > 0);

  const refresh = () => {
    clearTimeout(queuedRefresh);
    queuedRefresh = undefined;
    const active = picker.activeItems;
    picker.items = showsSearchRow() ? [searchRow, ...items] : items;
    picker.activeItems = active.filter((item) => item !== searchRow || showsSearchRow());
  };
  // Every assignment sends the whole list to the renderer, so batch the matches.
  const queueRefresh = () => {
    queuedRefresh ??= setTimeout(refresh, REFRESH_DELAY_MS);
  };

  const nextDownloads = (current: TermSearch) =>
    current.unsearched.slice(
      0,
      current.newestToDownload > 0 ? current.newestToDownload : MORE_DOWNLOADS,
    );

  const updateSearchRow = (current: TermSearch) => {
    searchRow.label = current.term;
    if (current.downloading > 0) {
      searchRow.iconPath = new ThemeIcon('loading~spin');
      searchRow.description = `- Searching ${plural(current.downloading, 'log')}…`;
      return;
    }
    searchRow.iconPath = downloadIcon;
    const next = nextDownloads(current);
    const size =
      current.newestToDownload > 0 && next.length < newest
        ? `download ${next.length}, ${totalSize(next)}`
        : totalSize(next);
    const action =
      current.newestToDownload > 0
        ? `Search newest ${plural(newest, 'log')}`
        : next.length < current.unsearched.length
          ? `Search next ${plural(next.length, 'older log')}`
          : `Search ${plural(next.length, 'older log')}`;
    searchRow.description = `- ${action} (${size}) · Downloads from the org`;
  };

  const updateClearButton = () => {
    const { count, bytes } = options.cache.size();
    clearButton =
      count > 0
        ? {
            iconPath: new ThemeIcon('trash'),
            tooltip: `Clear ${plural(count, 'cached log')} (${megabytes(bytes)})`,
          }
        : undefined;
    picker.buttons = clearButton ? [clearButton] : [];
  };

  const status = (current: TermSearch) =>
    ` · ${plural(current.matches, 'match', 'matches')}` +
    (current.failed.size > 0 ? ` · ${current.failed.size} failed, see Output` : '') +
    (current.unsearched.length > 0
      ? ` · ${current.unsearched.length} ${current.newestToDownload > 0 ? '' : 'older '}not searched`
      : '');

  const runSearch = (current: TermSearch, toSearch: PickerLog[], downloads: boolean) => {
    const before = current.searched;
    current.running++;
    picker.busy = true;
    searchLogContent(toSearch, current.term, store, {
      signal: current.cancellation.signal,
      onMatch: ({ logId, snippet }) => {
        current.matches++;
        itemsById.get(logId)?.showMatch(snippet);
        queueRefresh();
      },
      onProgress: (done, total) => {
        if (!current.cancellation.signal.aborted) {
          picker.title = `Searching ${before + done}/${before + total}${status(current)}`;
        }
      },
      onError: (logId, error, searched) => {
        options.output(
          `Log content search could not read or cache Apex log ${logId}: ${errorMessage(error)}`,
          !searched && current.failed.size === 0,
        );
        if (!searched) {
          current.failed.add(logId);
        }
      },
    })
      .then(() => {
        current.running--;
        if (current.cancellation.signal.aborted) {
          return;
        }
        const failed = toSearch.filter((log) => current.failed.has(log.Id));
        current.searched += toSearch.length - failed.length;
        current.unsearched = newestFirst([...current.unsearched, ...failed]);
        if (downloads) {
          current.downloading = 0;
        }
        picker.busy = current.running > 0;
        picker.title = `Searched ${plural(current.searched, 'log')}${status(current)}`;
        updateSearchRow(current);
        updateClearButton();
        refresh();
      })
      .catch((error: unknown) =>
        options.output(`Log content search failed: ${errorMessage(error)}`),
      );
  };

  const startTerm = (value: string) => {
    const trimmed = value.trim();
    const term = trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : undefined;
    if (term === search?.term) {
      return;
    }
    clearTimeout(delay);
    search?.cancellation.abort();
    search = undefined;
    items.forEach((item) => item.clearMatch());
    picker.title = undefined;
    picker.busy = false;

    if (term !== undefined) {
      const unsearched = sorted.filter((log) => !store.has(log.Id));
      const current: TermSearch = {
        term,
        cancellation: new AbortController(),
        unsearched,
        newestToDownload: unsearched.filter((log) => newestIds.has(log.Id)).length,
        searched: 0,
        matches: 0,
        failed: new Set(),
        running: 0,
        downloading: 0,
      };
      search = current;
      updateSearchRow(current);
      const cached = sorted.filter((log) => store.has(log.Id));
      if (cached.length > 0) {
        delay = setTimeout(() => runSearch(current, cached, false), SEARCH_DELAY_MS);
      }
    }
    refresh();
  };

  const searchNext = (current: TermSearch) => {
    if (current.downloading > 0) {
      return;
    }
    const next = nextDownloads(current);
    next.forEach((log) => current.failed.delete(log.Id));
    current.unsearched = current.unsearched.slice(next.length);
    current.newestToDownload = 0;
    current.downloading = next.length;
    updateSearchRow(current);
    refresh();
    runSearch(current, next, true);
  };

  return new Promise((resolve) => {
    picker.onDidChangeValue(startTerm);
    picker.onDidAccept(() => {
      const [selected] = picker.selectedItems;
      if (selected === searchRow) {
        if (search) {
          searchNext(search);
        }
        return;
      }
      resolve(selected instanceof DebugLogItem ? selected.logId : undefined);
      picker.hide();
    });
    picker.onDidTriggerButton(async (button) => {
      if (button === clearButton && (await options.cache.clear())) {
        updateClearButton();
        search?.cancellation.abort();
        search = undefined;
        startTerm(picker.value);
      }
    });
    picker.onDidHide(() => {
      clearTimeout(delay);
      clearTimeout(queuedRefresh);
      search?.cancellation.abort();
      resolve(undefined);
      picker.dispose();
    });
    updateClearButton();
    refresh();
    picker.show();
  });
}

function totalSize(logs: SearchableLog[]): string {
  return megabytes(logs.reduce((total, log) => total + log.LogLength, 0));
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 *
 * The function automatically selects the most appropriate unit (milliseconds, seconds, or minutes)
 * based on the duration value and applies appropriate precision rounding.
 *
 * @param ms - The duration in milliseconds to format
 * @returns A formatted string representing the duration with appropriate units:
 *   - Values < 1000ms: returns in milliseconds (e.g., "1.23 ms", "45.6 ms", "789 ms")
 *   - Values < 60s: returns in seconds (e.g., "1.23 s", "45.6 s")
 *   - Values >= 60s: returns in minutes and seconds (e.g., "2m", "2m 30s", "5m 15.5s")
 *
 * @example
 * formatDuration(500)      // "500 ms"
 * formatDuration(1500)     // "1.5 s"
 * formatDuration(120000)   // "2m"
 * formatDuration(150000)   // "2m 30s"
 */
function formatDuration(ms: number): string {
  if (!ms) {
    return '0 ms';
  }

  if (ms < 1000) {
    const precision = ms < 10 ? 100 : ms < 100 ? 10 : 1;
    return `${round(ms, precision)} ms`;
  }

  const s = ms / 1000;
  if (s < 60) {
    const precision = s < 10 ? 100 : s < 100 ? 10 : 1;
    return `${round(s, precision)} s`;
  }

  const m = Math.floor(s / 60);
  const sec = s % 60;

  if (sec === 0) {
    return `${m}m`;
  }

  const secStr = sec === Math.floor(sec) ? `${sec}s` : `${round(sec, 10)}s`;
  return `${m}m ${secStr}`;
}

function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}
