/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { rawStoreOf } from '#test-helpers/apexLog.js';
import { governorLimits, limitValue } from '#test-helpers/limits.js';
import { eventLabel, eventName, formatCallStack, formatEventDetails } from '../eventText.js';

const limits = governorLimits({
  soqlQueries: limitValue(1, 100),
  queryRows: limitValue(300, 50000),
  dmlStatements: limitValue(1, 150),
  dmlRows: limitValue(3, 10000),
  soslQueries: limitValue(0, 20),
});

const SETTINGS = '64.0 APEX_CODE,FINEST;WORKFLOW,FINEST;VALIDATION,INFO;SYSTEM,FINE;DB,FINEST\n';

/** Every event `lines` parse to, in log order; each line is `<nanoseconds>|<rest>`. */
async function eventsOf(...lines: string[]): Promise<ApexEvent[]> {
  const body = lines.map((line) => `09:18:22.6 (${line.replace('|', ')|')}\n`).join('');
  const { log } = await rawStoreOf(body, SETTINGS);
  return [...log.events];
}

async function firstEventOf(...lines: string[]): Promise<ApexEvent> {
  return (await eventsOf(...lines))[0]!; // every case writes at least one event
}

const method = (start: number, end: number, name: string, ...inner: string[]): string[] => [
  `${start}|METHOD_ENTRY|[1]|01p|${name}`,
  ...inner,
  `${end}|METHOD_EXIT|[1]|${name}`,
];

describe('eventName', () => {
  it('is the text alone for a method', async () => {
    expect(eventName(await firstEventOf(...method(1000, 2000, 'MyClass.run()')))).toBe(
      'MyClass.run()',
    );
  });

  // The suffix tells a constructor from a method of the same text.
  it('appends the suffix of a constructor', async () => {
    const event = await firstEventOf(
      '1000|CONSTRUCTOR_ENTRY|[5]|01p|<init>()|c2g.AbstractTaxHandler',
      '2000|CONSTRUCTOR_EXIT|[5]|01p|<init>()|c2g.AbstractTaxHandler',
    );

    expect(eventName(event)).toBe('c2g.AbstractTaxHandler() (constructor)');
  });

  // The suffix comes from the code unit above, so a lookup by type alone gets it wrong.
  it('names what started flow interviews', async () => {
    const events = await eventsOf(
      '1000|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:Account',
      '1100|FLOW_START_INTERVIEWS_BEGIN|1',
      '1200|FLOW_START_INTERVIEWS_END|1',
      '1300|CODE_UNIT_FINISHED|Workflow:Account',
    );

    expect(eventName(events[1]!)).toBe('FLOW_START_INTERVIEWS_BEGIN (Process Builder)');
  });
});

describe('eventLabel', () => {
  it('leaves text that identifies itself alone', async () => {
    expect(
      eventLabel(
        await firstEventOf(
          ...method(1000, 2000, 'fflib_SObjectDomain.triggerHandler(System.Type)'),
        ),
      ),
    ).toBe('fflib_SObjectDomain.triggerHandler(System.Type)');
  });

  it('prefixes the type to a lone boolean', async () => {
    expect(eventLabel(await firstEventOf('1000|SYSTEM_MODE_ENTER|false'))).toBe(
      'SYSTEM_MODE_ENTER: false',
    );
  });

  it('is the type alone, once, for an event with no text', async () => {
    expect(eventLabel(await firstEventOf('1000|VALIDATION_PASS'))).toBe('VALIDATION_PASS');
    expect(eventLabel(await firstEventOf('1000|EXECUTION_STARTED'))).toBe('EXECUTION_STARTED');
  });
});

describe('formatEventDetails', () => {
  it('reports name, type and duration with self time', async () => {
    const event = await firstEventOf(
      ...method(0, 5_000_000, 'MyClass.run()', ...method(2_000_000, 5_000_000, 'MyClass.inner()')),
    );

    expect(formatEventDetails(event)).toBe(
      ['Name: MyClass.run()', 'Type: METHOD_ENTRY', 'Duration: 5 ms (self 2 ms)'].join('\n'),
    );
  });

  it('omits duration for a leaf, which spans no time', async () => {
    expect(formatEventDetails(await firstEventOf('1000|SYSTEM_MODE_ENTER|false'))).toBe(
      'Name: false\nType: SYSTEM_MODE_ENTER',
    );
  });

  it('includes only non-zero governor metrics, against their limits', async () => {
    const event = await firstEventOf(
      '0|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
      '1000000|SOQL_EXECUTE_END|[1]|Rows:300',
    );

    const details = formatEventDetails(event, limits);

    expect(details).toContain('SOQL: 1/100 (self 1)');
    expect(details).toContain('SOQL Rows: 300/50000 (self 300)');
    expect(details).not.toContain('DML');
  });

  it('meters SOSL rows against the per-query cap, not the query-count limit', async () => {
    const [outer, sosl] = await eventsOf(
      ...method(
        0,
        3000,
        'MyClass.search()',
        '1000|SOSL_EXECUTE_BEGIN|[1]|FIND {Acme}',
        '2000|SOSL_EXECUTE_END|[1]|Rows:137',
      ),
    );

    // 20 is the SOSL *query* limit — using it here would read "137/20".
    expect(formatEventDetails(sosl!, limits)).toContain('SOSL Rows: 137/2000 (self 137)');
    // A method that merely contains SOSL work has no per-query cap to report.
    expect(formatEventDetails(outer!, limits)).toContain('SOSL Rows: 137 (self 0)');
  });

  it('drops the limit denominator when no limits are supplied', async () => {
    const event = await firstEventOf(
      '0|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1',
      '1000|DML_END|[1]',
    );

    expect(formatEventDetails(event)).toContain('DML: 1 (self 1)');
  });
});

describe('formatCallStack', () => {
  it('lists the lineage outermost first, one frame per line', async () => {
    const events = await eventsOf(
      '0|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
      ...method(
        1000,
        4000,
        'MyClass.run()',
        '2000|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
        '3000|SOQL_EXECUTE_END|[1]|Rows:0',
      ),
      '5000|CODE_UNIT_FINISHED|execute_anonymous_apex',
    );

    expect(formatCallStack(events[2]!)).toBe(
      ['execute_anonymous_apex (code unit)', 'MyClass.run()', 'SELECT Id FROM Account'].join('\n'),
    );
  });

  it('returns just the frame when it has no parent', async () => {
    expect(formatCallStack(await firstEventOf(...method(0, 1000, 'lonely()')))).toBe('lonely()');
  });
});
