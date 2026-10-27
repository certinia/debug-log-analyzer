/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type ApexLog, LEVEL, parse } from '@apexdevtools/apex-log-parser';

import type { LogIndex } from '../../core/log/LogIndex.js';
import { logStoreFor, type Derivation, type LogStore } from '../../core/log/LogStore.js';

/**
 * The header line, which decides what the log records. The level comes from the
 * enum the code under test branches on, so the two cannot drift apart.
 */
export const SETTINGS = {
  finest: `64.0 APEX_CODE,${LEVEL.Finest};APEX_PROFILING,NONE;DB,NONE\n`,
  fine: `64.0 APEX_CODE,${LEVEL.Fine};APEX_PROFILING,NONE;DB,NONE\n`,
};

/**
 * `body` inside the execution and code unit a real log wraps it in. The body is
 * what a test is about, so it stays in the test; this is the envelope that has to
 * be there for the parser to reach it.
 */
function logText(body: string, settings: string): string {
  // A duration is `exitStamp - timestamp`, so the footer has to close after the
  // last line the body stamps, or the code unit gets a negative one.
  let closed = 900000;
  for (const match of body.matchAll(/^\d\d:\d\d:\d\d\.\d+ \((\d+)\)/gm)) {
    closed = Math.max(closed, Number(match[1]) + 1000);
  }

  return (
    settings +
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
    body +
    `09:18:22.6 (${closed})|CODE_UNIT_FINISHED|apex://pkg.Entry\n` +
    `09:18:22.6 (${closed + 1000})|EXECUTION_FINISHED\n`
  );
}

/**
 * {@link logText}, parsed, with the store the components read it through. The
 * two are one graph: `store.log` is the same object as `log`.
 */
export async function storeOf(
  body: string,
  settings = SETTINGS.finest,
): Promise<{ log: ApexLog; store: LogStore }> {
  const log = await parse(logText(body, settings));
  return { log, store: logStoreFor(log) };
}

/** `body` parsed as the whole log, with no execution or code unit around it. */
export async function rawStoreOf(
  body: string,
  settings = SETTINGS.finest,
): Promise<{ log: ApexLog; store: LogStore }> {
  const log = await parse(settings + body);
  return { log, store: logStoreFor(log) };
}

/**
 * A store with no index, for a test that stubs every derivation it reaches: each
 * one gets the store, so one derivation can still ask for another.
 */
export function stubStore(log: ApexLog): LogStore {
  const store = {
    log,
    debugLevels: log.debugLevels,
    derive: async (fn: Derivation<unknown>) => fn(null as unknown as LogIndex, store),
    // A stub is not filtered and blames no level, so a section says what it said before.
    get captured() {
      return store;
    },
    levelGap: () => null,
  } as unknown as LogStore;
  return store;
}

/** The id of the first event whose text is `text`. */
export function indexOf(log: ApexLog, text: string): number {
  const found = idsWhere(log, (id) => log.columns.text.at(id) === text)[0];
  if (found === undefined) {
    throw new Error(`no event with text ${text}`);
  }
  return found;
}

/** The id of every frame whose text is `text`, in log order. */
export function indexesOf(log: ApexLog, text: string): number[] {
  const { isFrame, text: texts } = log.columns;
  return idsWhere(log, (id) => isFrame[id] === 1 && texts.at(id) === text);
}

function idsWhere(log: ApexLog, test: (id: number) => boolean): number[] {
  const ids: number[] = [];
  for (let id = 1; id <= log.eventCount; id++) {
    if (test(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** A frame for {@link frameLines}: its text, the time it spends outside its children, and them. */
export interface FrameSpec {
  text: string;
  /** Nanoseconds, spent before the first child. */
  self?: number;
  type?: 'METHOD_ENTRY' | 'CODE_UNIT_STARTED';
  children?: readonly (FrameSpec | LineSpec)[];
}

/**
 * A line for {@link frameLines} that takes no time: a database statement of `rows`
 * rows, a thrown exception, or a limit usage block.
 */
export type LineSpec =
  { kind: 'dml' | 'soql' | 'sosl'; rows: number } | { kind: 'thrown' } | { kind: 'limits' };

const LINES: { [K in LineSpec['kind']]: (spec: Extract<LineSpec, { kind: K }>) => string[] } = {
  dml: ({ rows }) => [`DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:${rows}`, 'DML_END|[1]'],
  soql: ({ rows }) => [
    'SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
    `SOQL_EXECUTE_END|[1]|Rows:${rows}`,
  ],
  sosl: ({ rows }) => ['SOSL_EXECUTE_BEGIN|[1]|FIND {x}', `SOSL_EXECUTE_END|[1]|Rows:${rows}`],
  thrown: () => ['EXCEPTION_THROWN|[1]|System.NullPointerException: boom'],
  limits: () => [
    'CUMULATIVE_LIMIT_USAGE',
    'LIMIT_USAGE_FOR_NS|(default)|',
    'CUMULATIVE_LIMIT_USAGE_END',
  ],
};

const OPEN = {
  METHOD_ENTRY: (text: string) => `METHOD_ENTRY|[1]|01p|${text}`,
  CODE_UNIT_STARTED: (text: string) => `CODE_UNIT_STARTED|[EXTERNAL]|01q|${text}`,
};
const CLOSE = {
  METHOD_ENTRY: (text: string) => `METHOD_EXIT|[1]|${text}`,
  CODE_UNIT_STARTED: (text: string) => `CODE_UNIT_FINISHED|${text}`,
};

/**
 * Log lines for `frames`, one after another from `start` nanoseconds, so each
 * frame's self and total time are what the spec says.
 */
export function frameLines(frames: readonly (FrameSpec | LineSpec)[], start = 1000): string {
  let now = start;
  const lines: string[] = [];
  const write = (frame: FrameSpec | LineSpec): void => {
    if ('kind' in frame) {
      const written = (LINES[frame.kind] as (spec: LineSpec) => string[])(frame);
      lines.push(...written.map((line) => `09:18:22.6 (${now})|${line}\n`));
      return;
    }
    const type = frame.type ?? 'METHOD_ENTRY';
    lines.push(`09:18:22.6 (${now})|${OPEN[type](frame.text)}\n`);
    now += frame.self ?? 0;
    frame.children?.forEach(write);
    lines.push(`09:18:22.6 (${now})|${CLOSE[type](frame.text)}\n`);
  };
  frames.forEach(write);
  return lines.join('');
}
