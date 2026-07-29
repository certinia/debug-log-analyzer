/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { GovernorLimits, LogEvent } from 'apex-log-parser';

import { eventLabel, eventName, formatCallStack, formatEventDetails } from '../eventText.js';

type EventOptions = {
  text: string;
  type?: string;
  self?: number;
  total?: number;
  exitStamp?: number | null;
  suffix?: string | null;
  parent?: LogEvent | null;
  soqlTotal?: number;
  soqlSelf?: number;
  soqlRowTotal?: number;
  soqlRowSelf?: number;
  dmlTotal?: number;
  dmlSelf?: number;
  soslRowTotal?: number;
  soslRowSelf?: number;
};

let nextTimestamp = 1;

function createEvent(options: EventOptions): LogEvent {
  const event = {
    parent: options.parent ?? null,
    children: [],
    type: (options.type ?? 'METHOD_ENTRY') as LogEvent['type'],
    text: options.text,
    suffix: options.suffix ?? null,
    namespace: 'default',
    timestamp: nextTimestamp++,
    exitStamp: options.exitStamp === undefined ? 1000 : options.exitStamp,
    cpuType: '',
    duration: { self: options.self ?? 0, total: options.total ?? 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: options.soqlRowSelf ?? 0, total: options.soqlRowTotal ?? 0 },
    soslRowCount: { self: options.soslRowSelf ?? 0, total: options.soslRowTotal ?? 0 },
    dmlCount: { self: options.dmlSelf ?? 0, total: options.dmlTotal ?? 0 },
    soqlCount: { self: options.soqlSelf ?? 0, total: options.soqlTotal ?? 0 },
    soslCount: { self: 0, total: 0 },
  } as unknown as LogEvent;

  if (options.parent) {
    options.parent.children.push(event);
  }
  return event;
}

const limits = {
  soqlQueries: { used: 1, limit: 100 },
  queryRows: { used: 300, limit: 50000 },
  dmlStatements: { used: 1, limit: 150 },
  dmlRows: { used: 3, limit: 10000 },
  soslQueries: { used: 0, limit: 20 },
} as unknown as GovernorLimits;

describe('eventName', () => {
  it('appends the suffix when present', () => {
    expect(eventName(createEvent({ text: 'MyClass.run()' }))).toBe('MyClass.run()');
    expect(eventName(createEvent({ text: 'MyClass.run()', suffix: ' (exception)' }))).toBe(
      'MyClass.run() (exception)',
    );
  });
});

describe('eventLabel', () => {
  it('leaves text that identifies itself alone', () => {
    expect(
      eventLabel(createEvent({ text: 'fflib_SObjectDomain.triggerHandler(System.Type)' })),
    ).toBe('fflib_SObjectDomain.triggerHandler(System.Type)');
    // The suffix is what disambiguates, not the raw type.
    expect(
      eventLabel(
        createEvent({
          text: 'c2g.AbstractTaxHandler',
          type: 'CONSTRUCTOR_ENTRY',
          suffix: ' (constructor)',
        }),
      ),
    ).toBe('c2g.AbstractTaxHandler (constructor)');
  });

  it('falls back to the type when the text cannot stand alone', () => {
    // A lone boolean, a lone number, no text at all, or a repeat of the type.
    expect(eventLabel(createEvent({ text: 'false', type: 'SYSTEM_MODE_ENTER' }))).toBe(
      'SYSTEM_MODE_ENTER: false',
    );
    expect(eventLabel(createEvent({ text: '17', type: 'STATEMENT_EXECUTE' }))).toBe(
      'STATEMENT_EXECUTE: 17',
    );
    expect(eventLabel(createEvent({ text: '', type: 'VALIDATION_PASS' }))).toBe('VALIDATION_PASS');
    expect(eventLabel(createEvent({ text: 'VALIDATION_RULE', type: 'VALIDATION_RULE' }))).toBe(
      'VALIDATION_RULE: VALIDATION_RULE',
    );
  });
});

describe('formatEventDetails', () => {
  it('reports name, type and duration with self time', () => {
    const event = createEvent({
      text: 'MyClass.run()',
      total: 5_000_000,
      self: 2_000_000,
    });
    expect(formatEventDetails(event)).toBe(
      ['Name: MyClass.run()', 'Type: METHOD_ENTRY', 'Duration: 5 ms (self 2 ms)'].join('\n'),
    );
  });

  it('omits duration when the frame never exited', () => {
    const event = createEvent({ text: 'MyClass.run()', total: 5_000_000, exitStamp: null });
    expect(formatEventDetails(event)).toBe('Name: MyClass.run()\nType: METHOD_ENTRY');
  });

  it('includes only non-zero governor metrics, against their limits', () => {
    const event = createEvent({
      text: 'SELECT Id FROM Account',
      type: 'SOQL_EXECUTE_BEGIN',
      total: 1_000_000,
      soqlTotal: 1,
      soqlSelf: 1,
      soqlRowTotal: 300,
      soqlRowSelf: 300,
    });
    const details = formatEventDetails(event, limits);
    expect(details).toContain('SOQL: 1/100 (self 1)');
    expect(details).toContain('SOQL Rows: 300/50000 (self 300)');
    // No DML on this frame, so no DML lines at all.
    expect(details).not.toContain('DML');
  });

  it('meters SOSL rows against the per-query cap, not the query-count limit', () => {
    const sosl = createEvent({
      text: 'FIND {Acme}',
      type: 'SOSL_EXECUTE_BEGIN',
      soslRowTotal: 137,
      soslRowSelf: 137,
    });
    // 20 is the SOSL *query* limit — using it here would read "137/20".
    expect(formatEventDetails(sosl, limits)).toContain('SOSL Rows: 137/2000 (self 137)');

    // A method that merely contains SOSL work has no per-query cap to report.
    const method = createEvent({ text: 'MyClass.search()', soslRowTotal: 137, soslRowSelf: 0 });
    expect(formatEventDetails(method, limits)).toContain('SOSL Rows: 137 (self 0)');
  });

  it('drops the limit denominator when no limits are supplied', () => {
    const event = createEvent({ text: 'Insert:Account', dmlTotal: 1, dmlSelf: 1 });
    expect(formatEventDetails(event)).toContain('DML: 1 (self 1)');
  });
});

describe('formatCallStack', () => {
  it('lists the lineage outermost first, one frame per line', () => {
    const root = createEvent({ text: 'execute_anonymous_apex', type: 'CODE_UNIT_STARTED' });
    const middle = createEvent({ text: 'MyClass.run()', parent: root });
    const leaf = createEvent({
      text: 'SELECT Id FROM Account',
      type: 'SOQL_EXECUTE_BEGIN',
      parent: middle,
    });

    expect(formatCallStack(leaf)).toBe(
      ['execute_anonymous_apex', 'MyClass.run()', 'SELECT Id FROM Account'].join('\n'),
    );
  });

  it('returns just the frame when it has no parent', () => {
    expect(formatCallStack(createEvent({ text: 'lonely()' }))).toBe('lonely()');
  });
});
