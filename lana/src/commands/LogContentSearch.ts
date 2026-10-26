/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
/** The fields of an Apex log list row that the search reads. */
export interface SearchableLog {
  Id: string;
  LogLength: number;
  StartTime: string;
}

const SNIPPET_CONTEXT = 40;
const CHUNK_BYTES = 4 * 1024 * 1024;
const IN_FLIGHT_BUDGET_BYTES = 100 * 1024 * 1024;
// Each download is one org API request; small logs must not open hundreds at once.
const MAX_IN_FLIGHT = 8;

/** Where log bodies come from: the local cache first, else the org. */
export interface LogStore {
  has(logId: string): boolean;
  read(logId: string): Promise<Uint8Array>;
  download(logId: string): Promise<string>;
  write(logId: string, body: string): Promise<void>;
}

export interface ContentMatch {
  logId: string;
  snippet: string;
}

export interface LogSearchOptions {
  signal: AbortSignal;
  onMatch(match: ContentMatch): void;
  onProgress(done: number, total: number): void;
  /** `searched` is false when the log could not be read or downloaded. */
  onError(logId: string, error: unknown, searched: boolean): void;
}

/**
 * Searches log bodies for `term`, case-insensitive, and reports the first match in each log.
 *
 * Cached logs are searched first, as they cost no API call, then the rest download newest
 * first. At most 8 logs and 100 MB of logs are in flight at once.
 *
 * After `signal` aborts, no new log starts and no match is reported. A download already
 * running still finishes and is cached, because the request cannot be cancelled.
 */
export async function searchLogContent(
  logs: SearchableLog[],
  term: string,
  store: LogStore,
  options: LogSearchOptions,
): Promise<void> {
  const cached = newestFirst(logs.filter((log) => store.has(log.Id)));
  const cachedIds = new Set(cached.map((log) => log.Id));
  const uncached = newestFirst(logs.filter((log) => !cachedIds.has(log.Id)));

  const queue = [...cached, ...uncached];
  let done = 0;
  options.onProgress(done, queue.length);

  const report = (logId: string, snippet: string | undefined) => {
    if (snippet !== undefined && !options.signal.aborted) {
      options.onMatch({ logId, snippet });
    }
  };
  await runWithinBudget(queue, options.signal, async ({ Id: logId }) => {
    let searched = false;
    try {
      if (cachedIds.has(logId)) {
        report(logId, findSnippetInBytes(await store.read(logId), term));
        searched = true;
      } else {
        const body = await store.download(logId);
        report(logId, findSnippet(body, term));
        searched = true;
        await store.write(logId, body);
      }
    } catch (error: unknown) {
      options.onError(logId, error, searched);
    }
    options.onProgress(++done, queue.length);
  });
}

/**
 * The first case-insensitive match of `term` in `text`, with `SNIPPET_CONTEXT` characters
 * each side on one line. An ellipsis marks a cut end.
 */
export function findSnippet(text: string, term: string): string | undefined {
  const match = matcher(term).exec(text);
  return match ? snippetAt(text, match) : undefined;
}

function snippetAt(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - SNIPPET_CONTEXT);
  const end = Math.min(text.length, match.index + match[0].length + SNIPPET_CONTEXT);
  const line = text.slice(start, end).replace(/[\r\n\t]+/g, ' ');
  return `${start > 0 ? '…' : ''}${line}${end < text.length ? '…' : ''}`;
}

/** Decodes in chunks, so a large cached file is never held as bytes and a full string at once. */
function findSnippetInBytes(bytes: Uint8Array, term: string): string | undefined {
  const decoder = new TextDecoder();
  const pattern = matcher(term);
  // Room for a match and its context each side, so a match at a chunk end is found whole next.
  const overlap = term.length + 2 * SNIPPET_CONTEXT;
  let carry = '';
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, bytes.length);
    const last = end === bytes.length;
    const text = carry + decoder.decode(bytes.subarray(start, end), { stream: !last });
    const match = pattern.exec(text);
    if (match && (last || match.index + match[0].length + SNIPPET_CONTEXT <= text.length)) {
      return snippetAt(text, match);
    }
    carry = text.slice(-overlap);
  }
  return undefined;
}

function matcher(term: string): RegExp {
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/**
 * The order logs are searched in. Never by size: a log with an error in it is often larger, so a
 * size order would search the logs most likely to match last.
 */
export function newestFirst<T extends SearchableLog>(logs: T[]): T[] {
  return [...logs].sort((a, b) => Date.parse(b.StartTime) - Date.parse(a.StartTime));
}

/**
 * Runs `work` in order, with in-flight `LogLength` at most the budget and at most
 * `MAX_IN_FLIGHT` logs; a larger log runs alone.
 */
async function runWithinBudget(
  logs: SearchableLog[],
  signal: AbortSignal,
  work: (log: SearchableLog) => Promise<void>,
): Promise<void> {
  const running = new Set<Promise<void>>();
  let inFlight = 0;
  for (const log of logs) {
    while (
      running.size >= MAX_IN_FLIGHT ||
      (running.size > 0 && inFlight + log.LogLength > IN_FLIGHT_BUDGET_BYTES)
    ) {
      await Promise.race(running);
    }
    if (signal.aborted) {
      break;
    }
    inFlight += log.LogLength;
    const task = work(log).finally(() => {
      inFlight -= log.LogLength;
      running.delete(task);
    });
    running.add(task);
  }
  await Promise.all(running);
}
