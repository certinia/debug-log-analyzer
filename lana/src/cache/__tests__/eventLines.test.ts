/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from '@apexdevtools/apex-log-parser';

import { eventLines } from '../eventLines.js';

/** Each event's start line and exit line, by id, for a log of `lines`. */
async function linesOf(lines: string[]): Promise<[number, number][]> {
  const log = await parse(lines.join('\n'));
  const { startLine, exitLine } = eventLines(log, lines.length, (line) => lines[line]!);
  return Array.from({ length: log.eventCount }, (_, index) => [
    startLine[index + 1]!,
    exitLine[index + 1]!,
  ]);
}

const at = (ns: number, line: string) => `09:18:22.6 (${ns})|${line}`;

describe('eventLines', () => {
  it('gives two events that share a timestamp a line each', async () => {
    // A first-match timestamp lookup put both methods on line 0.
    expect(
      await linesOf([
        at(100, 'METHOD_ENTRY|[1]|01p|A.a()'),
        at(100, 'METHOD_ENTRY|[2]|01p|A.b()'),
        at(200, 'METHOD_EXIT|[2]|A.b()'),
        at(200, 'METHOD_EXIT|[1]|A.a()'),
      ]),
    ).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });

  it('closes each frame on its own exit line, inner first', async () => {
    expect(
      await linesOf([
        at(100, 'CODE_UNIT_STARTED|[EXTERNAL]|01q|Entry'),
        at(200, 'METHOD_ENTRY|[1]|01p|A.a()'),
        at(300, 'USER_DEBUG|[2]|DEBUG|hello'),
        at(400, 'METHOD_EXIT|[1]|A.a()'),
        at(500, 'CODE_UNIT_FINISHED|Entry'),
      ]),
    ).toEqual([
      [0, 4],
      [1, 3],
      // A leaf has no exit.
      [2, -1],
    ]);
  });

  it('gives a frame an outer exit unwound no exit line, and the outer frame its own', async () => {
    expect(
      await linesOf([
        at(100, 'DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1'),
        at(
          200,
          'CODE_UNIT_STARTED|[EXTERNAL]|01q|AccountTrigger on Account trigger event BeforeInsert',
        ),
        at(300, 'DML_END|[1]'),
      ]),
    ).toEqual([
      [0, 2],
      [1, -1],
    ]);
  });

  it('gives an outer exit to its own frame, not to an inner one an exception unwound', async () => {
    // Matched by type and end time alone, the unwound B took A's exit line, and A had none.
    expect(
      await linesOf([
        at(100, 'METHOD_ENTRY|[1]|01p|A.a()'),
        at(200, 'METHOD_ENTRY|[2]|01p|B.b()'),
        at(300, 'EXCEPTION_THROWN|[3]|System.NullPointerException: boom'),
        at(400, 'METHOD_EXIT|[1]|A.a()'),
      ]),
    ).toEqual([
      [0, 3],
      [1, -1],
      [2, -1],
    ]);
  });

  it('gives an exit line that closes no frame its own line, not the open frame exit', async () => {
    // The parser makes a stray exit an event. Taken as A's exit, it would close A early and leave line 4 unowned.
    expect(
      await linesOf([
        at(50, 'METHOD_EXIT|[9]|Z.z()'),
        at(100, 'METHOD_ENTRY|[1]|01p|A.a()'),
        at(150, 'DML_END|[2]'),
        at(200, 'USER_DEBUG|[3]|DEBUG|inside'),
        at(300, 'METHOD_EXIT|[1]|A.a()'),
      ]),
    ).toEqual([
      [0, -1],
      [1, 4],
      [2, -1],
      [3, -1],
    ]);
  });

  it('skips the lines the parser made no event of', async () => {
    expect(
      await linesOf([
        '64.0 APEX_CODE,FINEST',
        at(100, 'USER_DEBUG|[1]|DEBUG|first'),
        'a continuation of the message',
        at(150, 'NOT_A_REAL_EVENT|x'),
        at(200, 'USER_DEBUG|[2]|DEBUG|second'),
      ]),
    ).toEqual([
      [1, -1],
      [4, -1],
    ]);
  });
});
