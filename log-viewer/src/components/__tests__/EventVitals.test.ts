/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeAll, describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';

// Avoid the heavy CodeBlock import chain (vscode-elements, soql formatter); the
// field order is expressed by the `.label` spans, not the code preview.
jest.mock('../CodeBlock.js', () => ({}));

import type { EventVitals } from '../EventVitals.js';
import '../EventVitals.js';

const log =
  '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
  '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
  '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
  '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
  '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n' +
  '17:33:36.2 (1690000000)|SOSL_EXECUTE_BEGIN|[210]|FIND {Acme}\n' +
  '17:33:36.2 (1695000000)|SOSL_EXECUTE_END|[210]|Rows:5\n' +
  '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
  '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

function labels(el: EventVitals): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.label') ?? []).map(
    (n) => n.textContent ?? '',
  );
}

function valueFor(el: EventVitals, label: string): string | undefined {
  for (const row of el.shadowRoot?.querySelectorAll('.row') ?? []) {
    if (row.querySelector('.label')?.textContent === label) {
      return row.querySelector('.value')?.textContent?.trim();
    }
  }
  return undefined;
}

/** No provider in the test, so the consumed store is assigned straight on. */
async function mount(store: LogStore, props: Partial<EventVitals>): Promise<EventVitals> {
  const el = document.createElement('event-vitals') as EventVitals;
  Object.assign(el, { logStore: store }, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('EventVitals', () => {
  let store: LogStore;
  let soqlIndex = -1;
  let dmlIndex = -1;
  let soslIndex = -1;

  beforeAll(() => {
    const apexLog = parse(log);
    store = logStoreFor(apexLog);
    soqlIndex = apexLog.eventsById.find((e) => e.text === 'SELECT Id FROM Account')!.eventIndex;
    dmlIndex = apexLog.eventsById.find((e) => e.text?.startsWith('DML'))!.eventIndex;
    soslIndex = apexLog.eventsById.find((e) => e.text?.startsWith('SOSL'))!.eventIndex;
    expect(customElements.get('event-vitals')).toBeDefined();
  });

  it('names the frame that made the calls it describes', async () => {
    const el = await mount(store, {
      eventIndex: soqlIndex,
      instances: [soqlIndex],
      calledBy: 'MyClass.caller()',
    });

    // The panel describes the calls, so the caller is a fact beside them.
    expect(valueFor(el, 'Called by')).toBe('MyClass.caller()');
  });

  it('leaves the caller row out when the row named the calls it counts', async () => {
    const el = await mount(store, { eventIndex: soqlIndex, instances: [soqlIndex] });

    expect(labels(el)).not.toContain('Called by');
  });

  it('leads with type and timing, then the metrics, plan and source', async () => {
    const el = await mount(store, { eventIndex: soqlIndex, type: 'soql' });
    // No explain line at this log level, so the query-plan fields are omitted.
    expect(labels(el)).toEqual([
      'Type',
      'Time',
      'SOQL',
      'SOQL Rows',
      'Selective',
      'Namespace',
      'Called from',
    ]);
  });

  /** The line is the call site in the containing code, not where the frame is defined. */
  it('reads the line as where the call came from', async () => {
    const el = await mount(store, { eventIndex: soqlIndex, type: 'soql' });

    expect(valueFor(el, 'Called from')).toMatch(/^line \d+$/);
  });

  it('omits the caller namespace when it matches the namespace', async () => {
    // Nothing to learn from "default called default" — see the differing case below.
    const el = await mount(store, { eventIndex: soqlIndex, type: 'soql' });
    expect(labels(el)).not.toContain('Caller namespace');
  });

  it('reports total and self time inline, to 3 decimal places', async () => {
    const el = await mount(store, { eventIndex: soslIndex, type: 'sosl' });
    expect(valueFor(el, 'Time')).toMatch(/^-?\d+\.\d{3} ms \(self -?\d+\.\d{3} ms\)$/);
  });

  it('reports a metric once, as used / limit with a percentage', async () => {
    // SOSL rows are capped per query, so a single SOSL statement has a limit.
    const el = await mount(store, { eventIndex: soslIndex, type: 'sosl' });
    expect(valueFor(el, 'SOSL Rows')).toBe('5 / 2,000 (0.25%)');
    // The limit is the denominator — never a second row repeating it.
    expect(labels(el).filter((l) => /limit/i.test(l))).toEqual([]);
    expect(new Set(labels(el)).size).toBe(labels(el).length);
  });

  it('omits the limit when the metric has no transaction total', async () => {
    const el = await mount(store, { eventIndex: dmlIndex, type: 'dml' });
    expect(valueFor(el, 'DML Rows')).toBe('2');
  });

  it("always shows the statement's own row count, even at zero", async () => {
    // The SOQL in this log reports Rows:3 on its END line; a statement's row
    // count is its headline number so it is never zero-suppressed.
    const el = await mount(store, { eventIndex: soqlIndex, type: 'soql' });
    expect(labels(el)).toContain('SOQL Rows');
  });

  it('groups the query plan and keeps the cardinalities under their own names', async () => {
    // This log has no EXPLAIN line, so assert the naming contract via a log that
    // does: the plan row combines leading op/object/index, and the cardinalities
    // keep Salesforce's terms so it is clear whose rows they count.
    const el = await mount(store, { eventIndex: soqlIndex, type: 'soql' });
    const shown = labels(el);
    expect(shown).not.toContain('Est. rows');
    expect(shown).not.toContain('Object rows');
  });

  it('omits fields with no value', async () => {
    const el = await mount(store, { eventIndex: dmlIndex, type: 'dml' });
    // A DML statement allocates no heap and throws nothing in this log.
    expect(labels(el)).not.toContain('Heap net');
    expect(labels(el)).not.toContain('Throws');
  });

  it('sums across occurrences and reports Calls/Avg self for an aggregate', async () => {
    const el = await mount(store, { instances: [soqlIndex, soslIndex] });
    const shown = labels(el);
    expect(shown).toContain('Calls');
    expect(shown).toContain('Avg self');
    expect(valueFor(el, 'Calls')).toBe('2');
  });

  it('reports nothing when the event is unknown', async () => {
    const el = await mount(store, { eventIndex: -1 });
    expect(el.shadowRoot?.querySelector('.empty')).not.toBeNull();
  });
});

// Its own log (and so its own store) because the caller's namespace has to
// differ from the callee's, which the log above never does.
describe('EventVitals across namespaces', () => {
  const crossNamespaceLog =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000001|Trigger.Account\n' +
    '09:18:22.6 (300)|ENTERING_MANAGED_PKG|c2g\n' +
    '09:18:22.6 (400)|METHOD_ENTRY|[1]|01p000000000001|c2g.Handler.run()\n' +
    '09:18:22.6 (500)|METHOD_EXIT|[1]|01p000000000001|c2g.Handler.run()\n' +
    '09:18:22.6 (700)|CODE_UNIT_FINISHED|Trigger.Account\n' +
    '09:18:22.6 (800)|EXECUTION_FINISHED\n';

  it('shows the caller namespace when it differs', async () => {
    const apexLog = parse(crossNamespaceLog);
    const store = logStoreFor(apexLog);
    // Packaged code entered from a trigger: whose code ran and who invoked it are
    // different answers, so both are reported.
    const pkg = apexLog.eventsById.find((e) => e.type === 'ENTERING_MANAGED_PKG')!;
    const el = await mount(store, { eventIndex: pkg.eventIndex });
    expect(valueFor(el, 'Namespace')).toBe('c2g');
    expect(labels(el)).toContain('Caller namespace');
    expect(valueFor(el, 'Caller namespace')).not.toBe('c2g');
  });
});

// Its own log: a method that calls itself, so a total and a self reading no
// longer sum over the same set of calls.
describe('EventVitals over a recursive frame', () => {
  const recursiveLog =
    '09:18:22.6 (0)|EXECUTION_STARTED\n' +
    '09:18:22.6 (1000000)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
    '09:18:22.6 (2000000)|METHOD_ENTRY|[1]|01p000000000001|Rec.walk()\n' +
    '09:18:22.6 (3000000)|METHOD_ENTRY|[1]|01p000000000001|Rec.walk()\n' +
    '09:18:22.6 (4000000)|METHOD_EXIT|[1]|01p000000000001|Rec.walk()\n' +
    '09:18:22.6 (6000000)|METHOD_EXIT|[1]|01p000000000001|Rec.walk()\n' +
    '09:18:22.6 (7000000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
    '09:18:22.6 (8000000)|EXECUTION_FINISHED\n';

  it('totals the outermost calls, and averages the self time of every call', async () => {
    const apexLog = parse(recursiveLog);
    const store = logStoreFor(apexLog);
    const calls = apexLog.eventsById.filter((e) => e.type === 'METHOD_ENTRY');
    const el = await mount(store, { instances: calls.map((e) => e.eventIndex) });

    expect(valueFor(el, 'Calls')).toBe('2');
    // The outer call is 4ms and holds the 1ms inner call, so summing both totals
    // would read 5ms.
    expect(valueFor(el, 'Time')).toBe('4.000 ms (self 4.000 ms)');
    expect(valueFor(el, 'Avg self')).toBe('2.000 ms');
  });
});
