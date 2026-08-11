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
// `detailEmptyText.js` is deliberately left unmocked so the assertions below
// exercise the real copy LogInspector renders.
//
// `deferSections` lets a test hold a build's resolution open so it can
// interleave a second, faster selection ahead of it (see the epoch test below);
// every other test leaves it false and gets an immediately-resolved build.
let deferSections = false;
const pendingSections: Array<() => void> = [];
jest.mock('../detailSections.js', () => ({
  buildDetailSections: (
    _source: string,
    selection: { eventIndex?: number } | null,
    activeEventIndex: number | null,
  ) => {
    // The markers carry the anchor and the active frame through to the rendered
    // content, so a stale build resolving late is distinguishable from the one
    // that supersedes it, and a walk is distinguishable from a new pick.
    const sections = selection
      ? [
          {
            id: 'vitals',
            title: 'Details',
            content: html`<div class="marker">${selection.eventIndex}</div>
              <div class="active">${activeEventIndex ?? '-'}</div>`,
          },
          { id: 'callstack', title: 'Call stack', content: html`<div>c</div>` },
        ]
      : [];
    if (!deferSections) {
      return Promise.resolve(sections);
    }
    return new Promise<typeof sections>((resolve) => {
      pendingSections.push(() => resolve(sections));
    });
  },
}));

import { eventBus } from '../../core/events/EventBus.js';
import type { LogInspector } from '../LogInspector.js';
import type { PaneView } from '../PaneView.js';
import '../LogInspector.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from '../inspectorReveal.js';

/**
 * Settles the async section build and the render chain through the nested
 * shadow DOMs. The build chain awaits more than once, so keep re-awaiting the
 * render rather than counting microtasks.
 */
async function settle(el: LogInspector): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await el.updateComplete;
  }
}

/** `settle`, plus the rAF wait that lets the debounced rebuild fire first. */
async function flush(el: LogInspector): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await settle(el);
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

/** The reveal listener sits on `dock-layout`, which renders whether or not a row is selected. */
function dockLayout(el: LogInspector): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>('dock-layout');
  if (!found) {
    throw new Error('dock-layout not rendered');
  }
  return found;
}

function visible(el: LogInspector): boolean {
  return !!el.shadowRoot?.querySelector('dock-layout')?.hasAttribute('visible');
}

function emptyText(el: LogInspector): string | null {
  const dock = el.shadowRoot
    ?.querySelector('dock-layout')
    ?.shadowRoot?.querySelector('detail-dock')
    ?.shadowRoot?.querySelector('.empty');
  return dock?.textContent?.trim() ?? null;
}

function select(source: 'timeline' | 'database', eventIndex: number): void {
  eventBus.emit('detail:select', { source, selection: { kind: 'event', eventIndex } });
}

function marker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.marker')?.textContent ?? null;
}

/** The frame the sections follow, `-` while the anchor is what is shown. */
function activeMarker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.active')?.textContent ?? null;
}

describe('LogInspector', () => {
  beforeEach(() => {
    written.length = 0;
    delete settings.inspector;
    deferSettings = false;
    releaseSettings = null;
    deferSections = false;
    pendingSections.length = 0;
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

  it('stamps the active tab on a reveal, so only that tab acts on it', async () => {
    const el = await mount('tree-tab');

    const seen: Array<{ source: string; eventIndex: number }> = [];
    const off = eventBus.on('inspector:reveal', (d) => seen.push(d));
    dispatchInspectorReveal(dockLayout(el), 5);
    off();

    expect(seen).toEqual([{ source: 'calltree', eventIndex: 5 }]);
  });

  it('follows a revealed frame while the selection that anchors the stack holds', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['1', '-']);

    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    // The anchor is what the call stack is built from, so it must not move.
    expect([marker(el), activeMarker(el)]).toEqual(['1', '5']);
  });

  it('ends the walk when the tab reports a new pick of its own', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);
    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    select('timeline', 7);
    await flush(el);

    expect([marker(el), activeMarker(el)]).toEqual(['7', '-']);
  });

  it('keeps each tab walking its own stack', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    select('database', 2);
    await flush(el);
    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    el.activeTab = 'database-tab';
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['2', '-']);

    el.activeTab = 'timeline-tab';
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['1', '5']);
  });

  it('stamps the active tab on a locate, and does not disturb the panel', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);

    const seen: Array<{ source: string; eventIndexes: readonly number[]; sticky: boolean }> = [];
    const off = eventBus.on('inspector:locate', (d) => seen.push(d));
    dispatchInspectorLocate(dockLayout(el), [5, 9]);
    dispatchInspectorLocate(dockLayout(el), []);
    dispatchInspectorLocate(dockLayout(el), [5, 9], true);
    off();

    expect(seen).toEqual([
      { source: 'timeline', eventIndexes: [5, 9], sticky: false },
      { source: 'timeline', eventIndexes: [], sticky: false },
      { source: 'timeline', eventIndexes: [5, 9], sticky: true },
    ]);
    // A locate picks nothing, so neither the anchor nor the walk moves.
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['1', '-']);
  });

  it('drops a mark the pointer never left when the tab changes', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    select('database', 2);
    await flush(el);
    dispatchInspectorLocate(dockLayout(el), [5]);

    const seen: Array<{ source: string; eventIndexes: readonly number[]; sticky: boolean }> = [];
    const off = eventBus.on('inspector:locate', (d) => seen.push(d));
    el.activeTab = 'database-tab';
    await flush(el);
    off();

    // Sticky, so a picked row's mark goes with the pointer's.
    expect(seen).toEqual([{ source: 'timeline', eventIndexes: [], sticky: true }]);
  });

  it('drops a reveal from a tab with no inspectable view', async () => {
    const el = await mount('unknown-tab');

    const seen: unknown[] = [];
    const off = eventBus.on('inspector:reveal', (d) => seen.push(d));
    dispatchInspectorReveal(dockLayout(el), 5);
    off();

    expect(seen).toEqual([]);
  });

  it('shows a source-specific empty state, and updates it as the active tab changes', async () => {
    settings.inspector = {
      position: 'right',
      size: 400,
      collapsed: {},
      paneSizes: {},
      visible: true,
    };
    const el = await mount('timeline-tab');
    expect(emptyText(el)).toBe('Select a frame on the timeline to inspect it.');

    el.activeTab = 'tree-tab';
    await flush(el);
    expect(emptyText(el)).toBe('Select a frame in the call tree to inspect it.');

    el.activeTab = 'analysis-tab';
    await flush(el);
    expect(emptyText(el)).toBe('Select a row in the analysis grid to inspect it.');

    el.activeTab = 'database-tab';
    await flush(el);
    expect(emptyText(el)).toBe('Select a SOQL, DML or SOSL row to inspect it.');
  });

  it('returns to the whole-log empty state when a null selection clears the source', async () => {
    settings.inspector = {
      position: 'right',
      size: 400,
      collapsed: {},
      paneSizes: {},
      visible: true,
    };
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);
    expect(marker(el)).toBe('1');

    eventBus.emit('detail:select', { source: 'timeline', selection: null });
    await flush(el);

    // marker() would throw here: the pane view unmounts with the selection.
    expect(emptyText(el)).toBe('Select a frame on the timeline to inspect it.');
  });

  it('drops a superseded rebuild: a stale build resolving late does not overwrite a newer one', async () => {
    // Mount undeferred so its own (empty-selection) rebuild resolves, then defer
    // only the two builds this test drives.
    const el = await mount('timeline-tab');
    deferSections = true;

    select('timeline', 1);
    await new Promise((resolve) => requestAnimationFrame(resolve)); // debounce fires -> _rebuild() epoch 1 starts, awaiting buildDetailSections
    select('timeline', 2);
    await new Promise((resolve) => requestAnimationFrame(resolve)); // debounce fires -> _rebuild() epoch 2 starts, awaiting buildDetailSections
    expect(pendingSections).toHaveLength(2);

    // The newer selection's build resolves first (it's the one the user is
    // waiting on); the stale epoch-1 build resolves afterwards, as it would if
    // its underlying walk was simply slower.
    pendingSections[1]!();
    await settle(el);
    expect(marker(el)).toBe('2');

    pendingSections[0]!();
    await settle(el);
    // The epoch guard drops the stale result — it must not clobber the newer one.
    expect(marker(el)).toBe('2');
  });
});
