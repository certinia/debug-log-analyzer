/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { ContextProvider } from '@lit/context';

import { logStatusContext, type LogStatus } from '../../core/log/logStatus.js';
import '../GridSkeleton.js';
import '../LogIdentity.js';
import '../LogLevels.js';
import '../LogMeta.js';
import '../LogProblemsChip.js';
import '../LogTitle.js';

const WAITING = [
  'grid-skeleton',
  'log-meta',
  'log-levels',
  'log-title',
  'log-identity',
  'log-problems',
];

type Updating = { updateComplete: Promise<unknown> };

function nested(el: HTMLElement): Element[] {
  return [...(el.shadowRoot?.querySelectorAll('*') ?? [])];
}

async function mount(tag: string, logStatus: LogStatus): Promise<HTMLElement> {
  // Through the context, not the property: a host may hold no status of its own
  // and leave the wait to a skeleton element that reads the context itself.
  const host = document.createElement('div');
  new ContextProvider(host, { context: logStatusContext, initialValue: logStatus });
  document.body.appendChild(host);

  const el = document.createElement(tag);
  host.appendChild(el);
  await (el as HTMLElement & Updating).updateComplete;
  for (const child of nested(el)) {
    await (child as Partial<Updating>).updateComplete;
  }
  return el;
}

function bars(el: HTMLElement): number {
  const roots = [el.shadowRoot, ...nested(el).map((child) => child.shadowRoot)];
  return roots.reduce(
    (count, root) => count + (root?.querySelectorAll('.skeleton').length ?? 0),
    0,
  );
}

describe('skeletons and the log they wait on', () => {
  it.each(WAITING)('%s shimmers while the log is on its way', async (tag) => {
    expect(bars(await mount(tag, 'parsing'))).toBeGreaterThan(0);
  });

  it.each(WAITING)('%s stops once the log will never arrive', async (tag) => {
    // The value it waits for is set from the parsed log, so on a failed parse it
    // stays empty and the pulse would otherwise run for the life of the panel.
    expect(bars(await mount(tag, 'failed'))).toBe(0);
  });
});
