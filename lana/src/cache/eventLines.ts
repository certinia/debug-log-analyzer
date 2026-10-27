/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type ApexLog, EVENT_TYPES, type EventTypeInfo } from '@apexdevtools/apex-log-parser';

/** By event id: the line the event starts on, and the exit line that closes a frame; -1 for none. */
export interface EventLines {
  start: Int32Array;
  end: Int32Array;
}

const EVENT_LINE = /^\d{2}:\d{2}:\d{2}\.\d+\s*\((\d+)\)\|([A-Z_]+)/;
const TYPE_BY_NAME = new Map<string, EventTypeInfo>(EVENT_TYPES.map((info) => [info.type, info]));

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
  const start = new Int32Array(log.eventCount + 1).fill(-1);
  const end = new Int32Array(log.eventCount + 1).fill(-1);
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
      const closes = (id: number) => !!EVENT_TYPES[type[id]!]?.exitTypes.includes(info.type);
      // A frame an outer exit unwound, or the next line closed, has no exit of its own.
      while (open.length && !closes(open.at(-1)!) && endTimestamp[open.at(-1)!]! <= time) {
        open.pop();
      }
      const top = open.at(-1);
      if (top !== undefined && endTimestamp[top] === time && closes(top)) {
        end[top] = line;
        open.pop();
        continue;
      }
    }
    if (next > log.eventCount || type[next] !== info.typeId || startTimestamp[next] !== time) {
      continue;
    }
    start[next] = line;
    while (open.length && open.at(-1) !== parent[next]) {
      open.pop();
    }
    if (isFrame[next]) {
      open.push(next);
    }
    next++;
  }
  return { start, end };
}
