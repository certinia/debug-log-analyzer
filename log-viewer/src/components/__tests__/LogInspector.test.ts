/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { html } from 'lit';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-badge.js', () => ({}));
jest.mock('#vscode-elements/vscode-button.js', () => ({}));
// The swc transform can't parse `.scss`/`.css`; stub the stylesheet assets.
jest.mock('../../tabulator/style/DataGrid.scss', () => ({ default: '' }));
jest.mock('../../tabulator/format/Progress.css', () => ({}));

const settings: { inspector?: unknown } = {};
const written: Array<{ section: string; value: unknown }> = [];
// Settings normally reply at once; `deferSettings` holds the reply so a test can
// interact while the load is still in flight.
let deferSettings = false;
let releaseSettings: (() => void) | null = null;
jest.mock('../../features/settings/Settings.js', () => ({
  getSettings: () =>
    deferSettings
      ? new Promise((resolve) => {
          releaseSettings = () => resolve(settings);
        })
      : Promise.resolve(settings),
  updateSetting: (section: string, value: unknown) => written.push({ section, value }),
}));

// The real builders mount Tabulator tables; only the section ids matter here.
jest.mock('../detailSections.js', () => ({
  buildDetailSections: (_source: string, selection: unknown) =>
    Promise.resolve(
      selection
        ? [
            { id: 'vitals', title: 'Details', content: html`<div>v</div>` },
            { id: 'callstack', title: 'Call stack', content: html`<div>c</div>` },
          ]
        : [],
    ),
}));

import { eventBus } from '../../core/events/EventBus.js';
import type { LogInspector } from '../LogInspector.js';
import type { PaneView } from '../PaneView.js';
import '../LogInspector.js';

/**
 * Settles the rAF-debounced rebuild, the async section build and the render.
 * The build chain awaits more than once, so keep re-awaiting the render rather
 * than counting microtasks.
 */
async function flush(el: LogInspector): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  for (let i = 0; i < 5; i++) {
    await el.updateComplete;
  }
}

async function mount(activeTab: string): Promise<LogInspector> {
  const el = document.createElement('log-inspector') as LogInspector;
  el.activeTab = activeTab;
  document.body.appendChild(el);
  await flush(el);
  return el;
}

function paneView(el: LogInspector): PaneView {
  const found = el.shadowRoot
    ?.querySelector('dock-layout')
    ?.shadowRoot?.querySelector('detail-dock')
    ?.shadowRoot?.querySelector<PaneView>('pane-view');
  if (!found) {
    throw new Error('pane-view not rendered');
  }
  return found;
}

function visible(el: LogInspector): boolean {
  return !!el.shadowRoot?.querySelector('dock-layout')?.hasAttribute('visible');
}

function select(source: 'timeline' | 'database', eventIndex: number): void {
  eventBus.emit('detail:select', { source, selection: { kind: 'event', eventIndex } });
}

describe('LogInspector', () => {
  beforeEach(() => {
    written.length = 0;
    delete settings.inspector;
    deferSettings = false;
    releaseSettings = null;
    document.body.replaceChildren();
  });

  it('applies the persisted collapse, and keeps it when the tab changes', async () => {
    settings.inspector = {
      position: 'right',
      size: 400,
      collapsed: { callstack: true },
      paneSizes: {},
      visible: true,
    };
    const el = await mount('database-tab');
    select('database', 3);
    await flush(el);

    expect(paneView(el).collapsed).toEqual({ callstack: true });

    // One panel, one layout: a section's collapse follows it across tabs.
    el.activeTab = 'timeline-tab';
    select('timeline', 9);
    await flush(el);

    expect(paneView(el).collapsed).toEqual({ callstack: true });
  });

  it('persists a collapse', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);

    paneView(el).dispatchEvent(
      new CustomEvent('pane-toggle', {
        detail: { collapsed: { callstack: true } },
        bubbles: true,
        composed: true,
      }),
    );

    expect(written).toEqual([{ section: 'inspector.collapsed', value: { callstack: true } }]);
  });

  it('auto-opens on the first selection only while the user has never chosen', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await el.updateComplete;
    expect(visible(el)).toBe(true);
  });

  it('stays closed when the user closed it before, and remembers each choice', async () => {
    settings.inspector = {
      position: 'right',
      size: 400,
      collapsed: {},
      paneSizes: {},
      visible: false,
    };
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await el.updateComplete;
    expect(visible(el)).toBe(false);

    eventBus.emit('detail:toggle', { visible: true });
    await el.updateComplete;
    expect(visible(el)).toBe(true);
    expect(written).toEqual([{ section: 'inspector.visible', value: true }]);
  });

  it('keeps what the user did while the settings load was still in flight', async () => {
    settings.inspector = {
      position: 'right',
      size: 400,
      collapsed: { callstack: true },
      paneSizes: {},
      visible: false,
    };
    deferSettings = true;
    const el = document.createElement('log-inspector') as LogInspector;
    el.activeTab = 'timeline-tab';
    document.body.appendChild(el);
    select('timeline', 1);
    await flush(el);

    // The user opens the panel and collapses a different section before the reply.
    eventBus.emit('detail:toggle', { visible: true });
    await flush(el);
    paneView(el).dispatchEvent(
      new CustomEvent('pane-toggle', {
        detail: { collapsed: { vitals: true } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    releaseSettings?.();
    await flush(el);

    // The stored `visible: false` and `collapsed` don't undo either action.
    expect(visible(el)).toBe(true);
    expect(paneView(el).collapsed).toEqual({ vitals: true });
  });
});
