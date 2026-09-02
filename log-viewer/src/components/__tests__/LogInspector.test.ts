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
    active: { kind: string; eventIndex?: number; instances?: number[] } | null,
    sourceView?: string,
  ) => {
    const walked = active?.kind === 'event' ? String(active.eventIndex) : '-';
    const counted = active?.kind === 'aggregate' ? (active.instances?.join(',') ?? '-') : '-';
    // The markers carry the anchor and the active frame through to the rendered
    // content, so a stale build resolving late is distinguishable from the one
    // that supersedes it, and a walk is distinguishable from a new pick.
    const sections = selection
      ? [
          {
            id: 'vitals',
            title: 'Details',
            content: html`<div class="marker">${selection.eventIndex}</div>
              <div class="active">${walked}</div>
              <div class="view">${sourceView ?? '-'}</div>
              <div class="bucket">${counted}</div>`,
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

import { eventBus, type DetailSource } from '../../core/events/EventBus.js';
import type { LogInspector } from '../LogInspector.js';
import type { PaneView } from '../PaneView.js';
import type { ViewModeSwitch } from '../ViewModeSwitch.js';
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

function select(source: DetailSource, eventIndex: number): void {
  eventBus.emit('detail:select', { source, selection: { kind: 'event', eventIndex } });
}

function marker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.marker')?.textContent ?? null;
}

/** The frame the sections follow, `-` while the anchor is what is shown. */
function activeMarker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.active')?.textContent ?? null;
}

/** The direction the tab reported, `-` while it has reported none. */
function viewMarker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.view')?.textContent ?? null;
}

/** The calls a picked merged row counts, `-` while no such row is picked. */
function bucketMarker(el: LogInspector): string | null {
  return paneView(el).shadowRoot?.querySelector('.bucket')?.textContent ?? null;
}

/** The scope switch is slotted into the dock, so it lives in the inspector's own root. */
function scopeSwitch(el: LogInspector): ViewModeSwitch | null {
  return el.shadowRoot?.querySelector<ViewModeSwitch>('view-mode-switch') ?? null;
}

function setScope(el: LogInspector, value: string): void {
  const found = scopeSwitch(el);
  if (!found) {
    throw new Error('view-mode-switch not rendered');
  }
  found.dispatchEvent(
    new CustomEvent('view-mode-change', { detail: { value }, bubbles: true, composed: true }),
  );
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

  it('follows the direction a tab turns to, leaving its selection alone', async () => {
    const el = await mount('tree-tab');
    select('calltree', 1);
    await flush(el);
    expect(viewMarker(el)).toBe('-');

    eventBus.emit('detail:view', { source: 'calltree', view: 'callers' });
    await flush(el);

    expect([marker(el), viewMarker(el)]).toEqual(['1', 'callers']);
  });

  it('ignores a tab reporting the direction it already showed', async () => {
    const el = await mount('tree-tab');
    select('calltree', 1);
    eventBus.emit('detail:view', { source: 'calltree', view: 'callees' });
    await flush(el);
    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    eventBus.emit('detail:view', { source: 'calltree', view: 'callees' });
    await flush(el);

    // No rebuild, so the walk down the stack is still where it was.
    expect(activeMarker(el)).toBe('5');
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

  it('describes what a picked row counts when it names no single frame', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);

    dispatchInspectorLocate(dockLayout(el), [5, 9], true, {
      kind: 'aggregate',
      instances: [5, 9],
    });
    await flush(el);

    // The bucket answers instead of a walked frame, and the anchor is untouched.
    expect([marker(el), activeMarker(el), bucketMarker(el)]).toEqual(['1', '-', '5,9']);
  });

  it('leaves the walk alone for a sticky mark that names no picked row', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    // A tree whose rows carry no aggregate marks stickily without picking one.
    dispatchInspectorLocate(dockLayout(el), [7, 8], true);
    await flush(el);

    expect(activeMarker(el)).toBe('5');
  });

  it('drops the picked row when the pick itself is dropped', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    dispatchInspectorLocate(dockLayout(el), [5, 9], true, {
      kind: 'aggregate',
      instances: [5, 9],
    });
    await flush(el);

    dispatchInspectorLocate(dockLayout(el), [], true);
    await flush(el);

    expect([marker(el), activeMarker(el), bucketMarker(el)]).toEqual(['1', '-', '-']);
  });

  it('drops the picked row once a single frame is walked to', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    dispatchInspectorLocate(dockLayout(el), [5, 9], true, {
      kind: 'aggregate',
      instances: [5, 9],
    });
    await flush(el);

    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);

    expect([activeMarker(el), bucketMarker(el)]).toEqual(['5', '-']);
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

  it('offers the scope switch only once there is a selection to switch away from', async () => {
    const el = await mount('timeline-tab');
    expect(scopeSwitch(el)).toBeNull();

    select('timeline', 1);
    await flush(el);
    expect(scopeSwitch(el)?.value).toBe('selection');

    eventBus.emit('detail:select', { source: 'timeline', selection: null });
    await flush(el);
    expect(scopeSwitch(el)).toBeNull();
  });

  it('reads the whole log in log scope, and keeps the selection to come back to', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);
    dispatchInspectorReveal(dockLayout(el), 5);
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['1', '5']);

    setScope(el, 'log');
    await flush(el);
    // marker() would throw: the selection's sections give way to the whole-log ones.
    expect(emptyText(el)).toBe('Select a frame on the timeline to inspect it.');

    setScope(el, 'selection');
    await flush(el);
    // The walked frame comes back with the anchor, so nothing is lost by looking away.
    expect([marker(el), activeMarker(el)]).toEqual(['1', '5']);
  });

  it('does not follow a whole-log reveal, so the walk survives the scope switch', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);

    setScope(el, 'log');
    await flush(el);
    dispatchInspectorReveal(dockLayout(el), 9);
    await flush(el);

    setScope(el, 'selection');
    await flush(el);
    expect([marker(el), activeMarker(el)]).toEqual(['1', '-']);
  });

  it('comes back to the selection when the tab reports a new pick', async () => {
    const el = await mount('timeline-tab');
    select('timeline', 1);
    await flush(el);
    setScope(el, 'log');
    await flush(el);

    select('timeline', 7);
    await flush(el);

    expect(scopeSwitch(el)?.value).toBe('selection');
    expect(marker(el)).toBe('7');
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
