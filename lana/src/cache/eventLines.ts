/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type ApexLog, EVENT_TYPES, type EventTypeInfo } from '@apexdevtools/apex-log-parser';

import { TIMESTAMP_REGEX } from '../log-utils.js';

/** By event id: the line the event starts on, and the exit line that closes a frame; -1 for none. */
export interface EventLines {
  startLine: Int32Array;
  exitLine: Int32Array;
}

const EVENT_LINE = new RegExp(`${TIMESTAMP_REGEX.source}([A-Z_]+)`);
const TYPE_BY_NAME = new Map<string, EventTypeInfo>(EVENT_TYPES.map((info) => [info.type, info]));

const closes = (frameType: number, exit: EventTypeInfo): boolean =>
  !!EVENT_TYPES[frameType]?.exitTypes.includes(exit.type);

const endedByExit = (log: ApexLog, id: number): boolean => {
  const event = log.event(id);
  return !!event?.isFrame && event.endedBy === 'exit';
};

/**
 * Each event's lines in a document of `lineCount` lines, read through `lineAt`.
 *
 * Lines are matched to events in order, by type and timestamp, so two events that share a
 * timestamp still get their own line. A line the parser made no event of is skipped.
 */
export function eventLines(
  log: ApexLog,
  lineCount: number,
  lineAt: (line: number) => string,
): EventLines {
  const { type, parent, isFrame, startTimestamp, endTimestamp } = log.columns;
  const startLine = new Int32Array(log.eventCount + 1).fill(-1);
  const exitLine = new Int32Array(log.eventCount + 1).fill(-1);
  const open: number[] = [];
  let next = 1;
  for (let line = 0; line < lineCount; line++) {
    const match = EVENT_LINE.exec(lineAt(line));
    const info = match?.[2] ? TYPE_BY_NAME.get(match[2]) : undefined;
    if (!match || !info) {
      continue;
    }
    const time = Number(match[1]);
    if (info.shape === 'exit') {
      // A frame an outer exit or an exception unwound, or the next line closed, has no exit of its own.
      // One event's endedBy, not the column: the column is a pass over the whole log, kept per log.
      let top = open.at(-1);
      while (
        top !== undefined &&
        endTimestamp[top]! <= time &&
        (!closes(type[top]!, info) || !endedByExit(log, top))
      ) {
        open.pop();
        top = open.at(-1);
      }
      if (top !== undefined && endTimestamp[top] === time && closes(type[top]!, info)) {
        exitLine[top] = line;
        open.pop();
        continue;
      }
    }
    if (next > log.eventCount || type[next] !== info.typeId || startTimestamp[next] !== time) {
      continue;
    }
    startLine[next] = line;
    while (open.length && open.at(-1) !== parent[next]) {
      open.pop();
    }
    if (isFrame[next]) {
      open.push(next);
    }
    next++;
  }
  return { startLine, exitLine };
}
