/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import {
  parse,
  type ApexEvent,
  type LogIssue as ParsedLogIssue,
} from '@apexdevtools/apex-log-parser';

import { toLogIssue, toLogIssues } from '../logIssues.js';

/** An issue on no event at time 0, with `fields` over it. */
function parsed(fields: Partial<ParsedLogIssue>): ParsedLogIssue {
  return {
    summary: '',
    description: '',
    type: 'error',
    startTimestamp: 0,
    endTimestamp: null,
    skippedBytes: null,
    event: null,
    exitType: null,
    ...fields,
  };
}

describe('toLogIssue', () => {
  it('maps severity, rail category and the call-tree action', () => {
    const issue = toLogIssue(
      parsed({
        summary: 'Skipped-Lines',
        description: 'lines skipped',
        type: 'skip',
        event: { id: 7 } as ApexEvent,
        startTimestamp: 120,
      }),
    );

    expect(issue.severity).toBe('warning');
    expect(issue.category).toBe('skip');
    expect(issue.timestamp).toBe(120);
    expect(issue.action?.label).toBe('Go to call tree');
    expect(issue.label).toBeNull();
  });

  it('labels fatal errors and thrown exceptions with their kind', () => {
    const fatal = toLogIssue(
      parsed({
        summary: 'System.LimitException: Apex CPU time limit exceeded',
        type: 'fatal',
        startTimestamp: 100,
      }),
    );
    const thrown = toLogIssue(
      parsed({
        summary: 'System.LimitException: Apex CPU time limit exceeded',
        type: 'error',
        startTimestamp: 50,
      }),
    );

    expect(fatal.severity).toBe('error');
    expect(fatal.category).toBe('exception');
    expect(fatal.label).toBe('Fatal error');
    expect(thrown.severity).toBe('error');
    expect(thrown.category).toBe('exception');
    expect(thrown.label).toBe('Exception');
  });

  it('leaves an issue with no event unactivatable', () => {
    const issue = toLogIssue(parsed({ summary: 'Max-Size-reached', type: 'unexpected' }));

    expect(issue.action).toBeNull();
    expect(issue.category).toBe('unexpected');
    expect(issue.severity).toBe('warning');
  });

  it('keeps a timestamp of 0 — the log can fail on its first line', () => {
    const issue = toLogIssue(parsed({ summary: 'boom', type: 'error', startTimestamp: 0 }));

    expect(issue.timestamp).toBe(0);
  });
});

describe('toLogIssues', () => {
  /** Both markers only fire on a bare line following a parsed event. */
  const PREAMBLE =
    '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
    '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex\n' +
    '09:18:22.7 (8000000)|METHOD_ENTRY|[1]|a1b|Foo.bar()\n';

  /** Every card, so a size landing on an issue that is not a skip shows up. */
  const cards = async (rawLog: string): Promise<[string, string | null][]> =>
    toLogIssues(await parse(rawLog)).map((issue) => [issue.summary, issue.label]);

  it('labels each skipped region with the size the parser read for it', async () => {
    const rawLog =
      PREAMBLE +
      '*** Skipped 121,000 bytes of detailed log\n' +
      '09:18:22.8 (9000000)|METHOD_EXIT|[1]|a1b|Foo.bar()\n' +
      '*** Skipped 34,500 bytes of detailed log\n' +
      '09:18:22.9 (10000000)|METHOD_ENTRY|[2]|a1b|Foo.baz()\n' +
      '******* MAXIMUM DEBUG LOG SIZE REACHED *******\n';

    expect(await cards(rawLog)).toEqual([
      ['Skipped-Lines', '121 KB'],
      ['Skipped-Lines', '34.5 KB'],
      ['Max-Size-reached', null],
      ['Unexpected-End', null],
    ]);
  });

  it('keeps two markers apart when they share the event that precedes them', async () => {
    const rawLog =
      PREAMBLE +
      '*** Skipped 121,000 bytes of detailed log\n' +
      '*** Skipped 34,500 bytes of detailed log\n' +
      '09:18:22.8 (9000000)|METHOD_EXIT|[1]|a1b|Foo.bar()\n' +
      '09:18:22.9 (10000000)|EXECUTION_FINISHED\n';

    expect(await cards(rawLog)).toEqual([
      ['Skipped-Lines', '121 KB'],
      ['Skipped-Lines', '34.5 KB'],
    ]);
  });

  it('leaves a neighbouring issue on the same event unlabelled', async () => {
    // The log stops at the marker, so `Unexpected-End` lands on the event the region names.
    const cardsBySummary = new Map(
      await cards(PREAMBLE + '*** Skipped 121,000 bytes of detailed log\n'),
    );

    expect(cardsBySummary.get('Skipped-Lines')).toBe('121 KB');
    expect(cardsBySummary.get('Unexpected-End')).toBeNull();
  });
});
