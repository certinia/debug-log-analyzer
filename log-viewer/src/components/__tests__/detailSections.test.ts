/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// Avoid the heavy component import chains (Tabulator, scss, vscode-elements);
// this suite only exercises the section-assembly logic.
jest.mock('../CallStackDetail.js', () => ({}));
jest.mock('../CallTreeDetail.js', () => ({}));
jest.mock('../EventVitals.js', () => ({}));

const databaseCalls: { eventIndex: number; type: string }[] = [];
jest.mock('../../features/database/components/databaseSections.js', () => ({
  buildDatabaseSections: async (selection: { eventIndex: number; type: string }) => {
    databaseCalls.push(selection);
    return [{ id: 'vitals', title: 'Details', content: undefined }];
  },
}));

import { buildDetailSections, emptyTextFor } from '../detailSections.js';

describe('buildDetailSections', () => {
  it('builds the shared trio for a timeline frame', async () => {
    const sections = await buildDetailSections('timeline', { kind: 'event', eventIndex: 4 });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
    // The call tree gets the most room, so it is the section worth reading.
    expect(sections.find((s) => s.id === 'calltree')?.weight).toBe(4);
  });

  it('delegates a database statement to the richer database sections', async () => {
    databaseCalls.length = 0;
    const sections = await buildDetailSections('database', {
      kind: 'event',
      eventIndex: 9,
      type: 'soql',
    });

    expect(databaseCalls).toEqual([{ eventIndex: 9, type: 'soql' }]);
    expect(sections.map((s) => s.id)).toEqual(['vitals']);
  });

  it('keeps the shared trio for a database selection that has no statement type', async () => {
    databaseCalls.length = 0;
    const sections = await buildDetailSections('database', { kind: 'event', eventIndex: 9 });

    expect(databaseCalls).toEqual([]);
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
  });

  it('scopes an aggregate selection to its first occurrence', async () => {
    const sections = await buildDetailSections('analysis', {
      kind: 'aggregate',
      instances: [11, 12, 13],
      label: 'MyClass.run()',
    });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
  });

  it('builds no sections when nothing is selected, for every source', async () => {
    for (const source of ['timeline', 'calltree', 'analysis', 'database'] as const) {
      expect(await buildDetailSections(source, null)).toEqual([]);
    }
  });
});

describe('emptyTextFor', () => {
  it('names what to click, per source', () => {
    expect(emptyTextFor('timeline')).toBe('Select a frame on the timeline to inspect it.');
    expect(emptyTextFor('calltree')).toBe('Select a frame in the call tree to inspect it.');
    expect(emptyTextFor('analysis')).toBe('Select a row in the analysis grid to inspect it.');
    expect(emptyTextFor('database')).toBe('Select a SOQL, DML or SOSL row to inspect it.');
  });

  it('falls back to a generic message when no tab is active', () => {
    expect(emptyTextFor(undefined)).toBe('Select a row to inspect it.');
  });
});
