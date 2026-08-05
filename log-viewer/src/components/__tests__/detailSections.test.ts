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
jest.mock('../CategoryTimeBar.js', () => ({}));
jest.mock('../EventVitals.js', () => ({}));
jest.mock('../ExecutionShape.js', () => ({}));
jest.mock('../GovernorTrends.js', () => ({}));
jest.mock('../LogOverview.js', () => ({}));

const databaseCalls: { eventIndex: number; type: string }[] = [];
jest.mock('../../features/database/components/databaseSections.js', () => ({
  buildDatabaseSections: async (selection: { eventIndex: number; type: string }) => {
    databaseCalls.push(selection);
    return [{ id: 'vitals', title: 'Details', content: undefined }];
  },
}));

import { buildDetailSections } from '../detailSections.js';

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

  it('builds only the whole-log overview for the database with nothing selected', async () => {
    const sections = await buildDetailSections('database', null);
    expect(sections.map((s) => s.id)).toEqual(['overview']);
    expect(sections[0]?.title).toBe('Log overview');
  });

  it('adds the execution shape to the call tree when nothing is selected', async () => {
    const sections = await buildDetailSections('calltree', null);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'shape']);
    expect(sections[1]?.title).toBe('Execution shape');
  });

  it('adds the charts and the whole-log call tree for the timeline with nothing selected', async () => {
    const sections = await buildDetailSections('timeline', null);
    expect(sections.map((s) => s.id)).toEqual([
      'overview',
      'category-time',
      'governor-trends',
      'calltree',
    ]);
    // The whole-log tree gets the most room, matching the selection layout.
    expect(sections.find((s) => s.id === 'calltree')?.weight).toBe(4);
  });

  it('adds the findings section on Analysis, which is that tab at log scope', async () => {
    const sections = await buildDetailSections('analysis', null);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'findings']);
    expect(sections[1]?.title).toBe('Findings');
  });
});
