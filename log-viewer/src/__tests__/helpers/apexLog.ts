/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_LEVEL, parse, type ApexLog } from 'apex-log-parser';

import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';

/**
 * The header line, which decides what the log records. The level comes from the
 * enum the code under test branches on, so the two cannot drift apart.
 */
export const SETTINGS = {
  finest: `64.0 APEX_CODE,${LOG_LEVEL.Finest};APEX_PROFILING,NONE;DB,NONE\n`,
  fine: `64.0 APEX_CODE,${LOG_LEVEL.Fine};APEX_PROFILING,NONE;DB,NONE\n`,
};

/**
 * `body` inside the execution and code unit a real log wraps it in. The body is
 * what a test is about, so it stays in the test; this is the envelope that has to
 * be there for the parser to reach it.
 *
 * Stamp the body between 200 and 900000. A duration is `exitStamp - timestamp`,
 * so a line stamped past the footer gives the code unit a negative one.
 */
function logText(body: string, settings = SETTINGS.finest): string {
  return (
    settings +
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
    body +
    '09:18:22.6 (900000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
    '09:18:22.6 (901000)|EXECUTION_FINISHED\n'
  );
}

/**
 * {@link logText}, parsed, with the store the components read it through. The
 * two are one graph: `store.log` is the same object as `log`.
 */
export function storeOf(
  body: string,
  settings = SETTINGS.finest,
): { log: ApexLog; store: LogStore } {
  const log = parse(logText(body, settings));
  return { log, store: logStoreFor(log) };
}

/** The eventIndex of the frame or event whose log text is `text`. */
export function indexOf(log: ApexLog, text: string): number {
  const found = log.eventsById.find((event) => event.text === text);
  if (!found) {
    throw new Error(`no event with text ${text}`);
  }
  return found.eventIndex;
}

/**
 * Every frame whose log text is `text`, in log order. Frames only: a METHOD_EXIT
 * carries the same text as the entry it closes.
 */
export function indexesOf(log: ApexLog, text: string): number[] {
  return log.eventsById
    .filter((event) => event.isParent && event.text === text)
    .map((event) => event.eventIndex);
}
