/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { idOf, storeOf } from '#test-helpers/apexLog.js';
import { filterByLevels } from '../../log/LogStore.js';
import { callerNamespaceOfRow, getCallerNamespace, namespaceOf } from '../CallerNamespace.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|pkg1.Trigger.run()\n' +
  '09:18:22.6 (1100)|SYSTEM_METHOD_ENTRY|[2]|System.debug(ANY)\n' +
  '09:18:22.6 (1200)|DML_BEGIN|[3]|Op:Insert|Type:Account|Rows:1\n' +
  '09:18:22.6 (1300)|DML_END|[3]\n' +
  '09:18:22.6 (1400)|SYSTEM_METHOD_EXIT|[2]|System.debug(ANY)\n' +
  '09:18:22.6 (1500)|DML_BEGIN|[4]|Op:Update|Type:Account|Rows:1\n' +
  '09:18:22.6 (1600)|DML_END|[4]\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[1]|pkg1.Trigger.run()\n';

describe('getCallerNamespace', () => {
  // The helper's code unit is `apex://pkg.Entry`, whose namespace the methods under it take.
  it("returns the direct caller's namespace", async () => {
    const { log, store } = await storeOf(LOG);

    expect(getCallerNamespace(store, idOf(log, 'DML Op:Update Type:Account'))).toBe('pkg');
  });

  it("returns 'default' at the top of the log", async () => {
    const { log, store } = await storeOf(LOG);

    expect(getCallerNamespace(store, log.entryPoints[0]!.id)).toBe('default');
  });

  it('skips a caller the levels hide, to the shown frame above it', async () => {
    const { log, store } = await storeOf(
      LOG,
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST;SYSTEM,FINE\n',
    );

    const shown = (await filterByLevels(store, { system: 'NONE' }))!; // no signal, never null

    expect(getCallerNamespace(shown, idOf(log, 'DML Op:Insert Type:Account'))).toBe('pkg');
  });
});

describe('callerNamespaceOfRow', () => {
  it("returns 'default' for a top row", async () => {
    const { log, store } = await storeOf(LOG);
    const index = await store.logIndex();

    expect(callerNamespaceOfRow(index, index.rowOf(log.entryPoints[0]!.id))).toBe('default');
  });

  // A hidden caller has no row, so reading the event's own parent gave its namespace instead.
  it('skips a caller the levels hide, to the shown frame above it', async () => {
    const { log, store } = await storeOf(
      LOG,
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST;SYSTEM,FINE\n',
    );
    const index = await (await filterByLevels(store, { system: 'NONE' }))!.logIndex(); // no signal, never null

    expect(callerNamespaceOfRow(index, index.rowOf(idOf(log, 'DML Op:Insert Type:Account')))).toBe(
      'pkg',
    );
  });
});

describe('namespaceOf', () => {
  it("reads the event's namespace, 'default' where it states none", async () => {
    const { log } = await storeOf(LOG);

    expect(namespaceOf(log, idOf(log, 'pkg1.Trigger.run()'))).toBe('pkg');
    expect(namespaceOf(log, idOf(log, 'DML Op:Insert Type:Account'))).toBe('default');
  });
});
