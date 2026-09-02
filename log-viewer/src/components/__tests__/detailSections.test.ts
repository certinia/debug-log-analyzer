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
jest.mock('../GovernorTrends.js', () => ({}));
jest.mock('../HotPath.js', () => ({}));
jest.mock('../HotSpots.js', () => ({}));
jest.mock('../LogOverview.js', () => ({}));
jest.mock('../NamespaceTimeBar.js', () => ({}));
jest.mock('../../features/database/components/DatabaseOverview.js', () => ({}));
jest.mock('../../features/database/components/DatabaseRowBudget.js', () => ({}));
jest.mock('../../features/database/components/DatabaseTimeTree.js', () => ({}));

const databaseCalls: { eventIndex: number; type: string; activeEventIndex?: number | null }[] = [];
jest.mock('../../features/database/components/databaseSections.js', () => ({
  buildDatabaseSections: async (selection: {
    eventIndex: number;
    type: string;
    activeEventIndex?: number | null;
  }) => {
    databaseCalls.push(selection);
    return [{ id: 'vitals', title: 'Details', content: undefined }];
  },
}));

import type { CallTreeDetail } from '../CallTreeDetail.js';
import { render, type TemplateResult } from 'lit';

import { buildDetailSections } from '../detailSections.js';
import type { PaneSection } from '../PaneView.js';

/**
 * The section content is a template, so it is rendered to read what each
 * component was handed. The components are stubbed above, so nothing upgrades —
 * only the attributes and properties are set.
 */
function rendered(sections: PaneSection[], id: string, tag: string): Element {
  const host = document.createElement('div');
  render(sections.find((s) => s.id === id)?.content as TemplateResult, host);
  const el = host.querySelector(tag);
  if (!el) {
    throw new Error(`${tag} not rendered for section ${id}`);
  }
  return el;
}

describe('buildDetailSections', () => {
  it('builds the shared trio for a timeline frame', async () => {
    const sections = await buildDetailSections('timeline', { kind: 'event', eventIndex: 4 });
    expect(sections.map((s) => s.id)).toEqual([
      'vitals',
      'namespace-time',
      'callstack',
      'calltree',
    ]);
    // The call tree gets the most room, so it is the section worth reading.
    expect(sections.find((s) => s.id === 'calltree')?.weight).toBe(4);
    // The vitals are a fixed set of figures: they take their own height only.
    expect(sections.find((s) => s.id === 'vitals')?.fit).toBe('content');
  });

  it('delegates a database statement to the richer database sections', async () => {
    databaseCalls.length = 0;
    const sections = await buildDetailSections('database', {
      kind: 'event',
      eventIndex: 9,
      type: 'soql',
    });

    expect(databaseCalls).toEqual([{ eventIndex: 9, type: 'soql', activeEventIndex: null }]);
    expect(sections.map((s) => s.id)).toEqual(['vitals']);
  });

  it('passes the frame walked to on to the database sections', async () => {
    databaseCalls.length = 0;
    await buildDetailSections(
      'database',
      { kind: 'event', eventIndex: 9, type: 'soql' },
      {
        kind: 'event',
        eventIndex: 4,
      },
    );

    expect(databaseCalls).toEqual([{ eventIndex: 9, type: 'soql', activeEventIndex: 4 }]);
  });

  it('anchors the stack and the tree to the selection, while Details follows the active frame', async () => {
    const sections = await buildDetailSections(
      'timeline',
      { kind: 'event', eventIndex: 4 },
      {
        kind: 'event',
        eventIndex: 2,
      },
    );

    expect(rendered(sections, 'callstack', 'call-stack-detail').getAttribute('eventIndex')).toBe(
      '4',
    );
    expect(
      rendered(sections, 'callstack', 'call-stack-detail').getAttribute('activeEventIndex'),
    ).toBe('2');
    expect(rendered(sections, 'vitals', 'event-vitals').getAttribute('eventIndex')).toBe('2');
    expect(rendered(sections, 'calltree', 'call-tree-detail').getAttribute('eventIndex')).toBe('4');
    expect(
      rendered(sections, 'calltree', 'call-tree-detail').getAttribute('activeEventIndex'),
    ).toBe('2');
  });

  it('marks the selection itself active while the user has not walked the stack', async () => {
    const sections = await buildDetailSections('timeline', { kind: 'event', eventIndex: 4 });

    expect(
      rendered(sections, 'callstack', 'call-stack-detail').getAttribute('activeEventIndex'),
    ).toBe('4');
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
    });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'findings', 'callstack', 'calltree']);
    expect(
      (rendered(sections, 'vitals', 'event-vitals') as HTMLElement & { instances: number[] | null })
        .instances,
    ).toEqual([11, 12, 13]);
  });

  it('asks the findings which of them name the selection', async () => {
    const sections = await buildDetailSections('analysis', {
      kind: 'aggregate',
      instances: [11, 12, 13],
    });

    const findings = rendered(sections, 'findings', 'log-diagnostics') as HTMLElement & {
      instances: number[] | null;
    };
    expect(findings.instances).toEqual([11, 12, 13]);
    // The verdict reads beside the tree rather than being crowded by it.
    expect(sections.find((s) => s.id === 'findings')?.weight).toBe(3);
  });

  it('scopes the findings to the frame being followed, not the aggregate it left', async () => {
    const sections = await buildDetailSections(
      'analysis',
      { kind: 'aggregate', instances: [11, 12, 13] },
      { kind: 'event', eventIndex: 8 },
    );

    const findings = rendered(sections, 'findings', 'log-diagnostics') as HTMLElement & {
      instances: number[] | null;
    };
    expect(findings.instances).toEqual([8]);
  });

  it('leaves the findings out for a selection from another tab', async () => {
    const sections = await buildDetailSections('timeline', { kind: 'event', eventIndex: 4 });
    expect(sections.map((s) => s.id)).toEqual([
      'vitals',
      'namespace-time',
      'callstack',
      'calltree',
    ]);
  });

  it('re-scopes the namespace split to the frame being followed', async () => {
    const sections = await buildDetailSections(
      'timeline',
      { kind: 'event', eventIndex: 4 },
      {
        kind: 'event',
        eventIndex: 2,
      },
    );

    expect(
      rendered(sections, 'namespace-time', 'namespace-time-bar').getAttribute('eventIndex'),
    ).toBe('2');
  });

  it('scopes the namespace split to every occurrence of an aggregate', async () => {
    const sections = await buildDetailSections('timeline', {
      kind: 'aggregate',
      instances: [11, 12, 13],
    });

    const bar = rendered(sections, 'namespace-time', 'namespace-time-bar') as HTMLElement & {
      instances: number[] | null;
    };
    expect(bar.instances).toEqual([11, 12, 13]);
  });

  it('leaves the namespace split out for a selection from another tab', async () => {
    const sections = await buildDetailSections('calltree', { kind: 'event', eventIndex: 4 });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
  });

  it('drops the aggregate once a single frame in its stack is the one being followed', async () => {
    const sections = await buildDetailSections(
      'analysis',
      { kind: 'aggregate', instances: [11, 12, 13] },
      { kind: 'event', eventIndex: 8 },
    );

    const vitals = rendered(sections, 'vitals', 'event-vitals') as HTMLElement & {
      instances: number[] | null;
    };
    expect(vitals.getAttribute('eventIndex')).toBe('8');
    expect(vitals.instances).toBeNull();
    expect(vitals.getAttribute('called-by')).toBe('');
  });

  it('describes the calls a walked bucket counts, as a bucket picked in the tab is', async () => {
    const sections = await buildDetailSections(
      'analysis',
      { kind: 'aggregate', instances: [11, 12, 13] },
      { kind: 'aggregate', instances: [21, 22], calledBy: 'Trigger1' },
    );

    const vitals = rendered(sections, 'vitals', 'event-vitals') as HTMLElement & {
      instances: number[] | null;
    };
    expect(vitals.instances).toEqual([21, 22]);
    expect(vitals.getAttribute('eventIndex')).toBe('21');
    expect(vitals.getAttribute('called-by')).toBe('Trigger1');
  });

  it('adds the whole-log database figures for the database with nothing selected', async () => {
    const sections = await buildDetailSections('database', null);
    expect(sections.map((s) => s.id)).toEqual([
      'overview',
      'database-namespaces',
      'database-concentration',
      'database-time',
    ]);
    expect(sections[0]?.title).toBe('Overview');
    // The call-path grid soaks up the leftover space; the rest keep their own.
    expect(sections.find((s) => s.id === 'database-time')?.weight).toBe(4);
    expect(sections.find((s) => s.id === 'database-time')?.fit ?? 'fill').toBe('fill');
    expect(sections.filter((s) => s.id !== 'database-time').every((s) => s.fit === 'content')).toBe(
      true,
    );
  });

  it('adds the hot path and hot spots to the call tree when nothing is selected', async () => {
    const sections = await buildDetailSections('calltree', null);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'hot-path', 'hot-spots']);
    expect(sections[1]?.title).toBe('Hot path');
    expect(sections[2]?.title).toBe('Hot spots');
    // Every section here is a short list: each takes its own height only.
    expect(sections.every((s) => s.fit === 'content')).toBe(true);
  });

  it('adds the charts and the whole-log call tree for the timeline with nothing selected', async () => {
    const sections = await buildDetailSections('timeline', null);
    expect(sections.map((s) => s.id)).toEqual([
      'overview',
      'category-time',
      'namespace-time',
      'governor-trends',
      'calltree',
    ]);
    // The whole-log tree soaks up the leftover space; the charts keep their own.
    expect(sections.find((s) => s.id === 'calltree')?.weight).toBe(4);
    expect(sections.find((s) => s.id === 'calltree')?.fit ?? 'fill').toBe('fill');
    expect(sections.find((s) => s.id === 'governor-trends')?.fit).toBe('content');
    // The tab draws the log top down, so the tree opens on where the time went.
    const tree = rendered(sections, 'calltree', 'call-tree-detail') as CallTreeDetail;
    expect(tree.sourceView).toBe('callees');
  });

  it('adds the findings section on Analysis, which is that tab at log scope', async () => {
    const sections = await buildDetailSections('analysis', null);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'findings', 'self-time-spread']);
    expect(sections[1]?.title).toBe('Findings');
  });
});
