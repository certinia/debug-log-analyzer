/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeAll, describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { DatabaseAccess } from '../../services/Database.js';

// Avoid the heavy CodeBlock import chain (vscode-elements, soql formatter); the
// vitals order is expressed by the `.label` spans, not the code preview.
jest.mock('../../../../components/CodeBlock.js', () => ({}));

import type { DbVitals } from '../DbVitals.js';
import '../DbVitals.js';

const log =
  '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
  '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
  '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
  '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
  '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n' +
  '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
  '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

function labels(el: DbVitals): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.label') ?? []).map(
    (n) => n.textContent ?? '',
  );
}

async function mount(eventIndex: number, type: 'soql' | 'dml'): Promise<DbVitals> {
  const el = document.createElement('db-vitals') as DbVitals;
  el.eventIndex = eventIndex;
  el.type = type;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('DbVitals field order', () => {
  let soqlIndex = -1;
  let dmlIndex = -1;

  beforeAll(async () => {
    const apexLog = parse(log);
    await DatabaseAccess.create(apexLog);
    soqlIndex = apexLog.eventsById.find((e) => e.text === 'SELECT Id FROM Account')!.eventIndex;
    dmlIndex = apexLog.eventsById.find((e) => e.text?.startsWith('DML'))!.eventIndex;
    expect(customElements.get('db-vitals')).toBeDefined();
  });

  it('orders SOQL vitals by usefulness with namespace elevated', async () => {
    const el = await mount(soqlIndex, 'soql');
    // No explain line at this log level, so the query-plan fields are omitted.
    expect(labels(el)).toEqual(['Rows', 'Time', 'Namespace', 'Selective', 'Aggregations', 'Line']);
  });

  it('orders DML vitals by usefulness', async () => {
    const el = await mount(dmlIndex, 'dml');
    expect(labels(el)).toEqual(['Rows', 'Time', 'Namespace', 'Caller namespace', 'Line']);
  });
});
