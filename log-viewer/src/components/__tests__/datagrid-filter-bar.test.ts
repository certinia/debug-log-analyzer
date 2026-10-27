/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import type { AnchoredPopover } from '../AnchoredPopover.js';
import type { DatagridFilterBar } from '../datagrid-filter-bar.js';
import '../datagrid-filter-bar.js';
import type { ToolbarAction } from '../ToolbarAction.js';
import '../ToolbarAction.js';

/** The bar's observer callback, standing in for a window resize or a section that widens. */
let observed: ResizeObserverCallback | null = null;
let host: Element | null = null;

class StubResizeObserver {
  private cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }

  observe(target: Element): void {
    if (target.tagName === 'DATAGRID-FILTER-BAR') {
      observed = this.cb;
      host = target;
    }
  }

  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom lays nothing out, so each section reports a fixed width by its slot name. */
let sectionWidths: Record<string, number> = {};

const realResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = StubResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      const name = this.querySelector(':scope > slot')?.getAttribute('name');
      return name ? (sectionWidths[name] ?? 0) : 0;
    },
  });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = realResizeObserver;
});

beforeEach(() => {
  sectionWidths = { global: 200, 'table-actions': 100, group: 60, actions: 80 };
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Wide enough for everything; narrow enough for global + table-actions only, with tens of px to spare either way. */
const WIDE = 1000;
const NARROW = 480;

async function mount(
  slots = ['global', 'table-actions', 'filters', 'group', 'actions'],
): Promise<DatagridFilterBar> {
  const el = document.createElement('datagrid-filter-bar') as DatagridFilterBar;
  for (const slot of slots) {
    const child = document.createElement(slot === 'actions' ? 'toolbar-action' : 'div');
    child.id = slot;
    child.setAttribute('label', 'Export to CSV');
    child.setAttribute('slot', slot);
    el.appendChild(child);
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function settle(el: DatagridFilterBar): Promise<void> {
  await el.updateComplete;
  await el.updateComplete;
}

async function resize(el: DatagridFilterBar, width: number): Promise<void> {
  observed?.(
    [{ target: host, contentRect: { width } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  await settle(el);
}

/** A section's own box changed, with no host resize. */
async function sectionResized(el: DatagridFilterBar): Promise<void> {
  observed?.([], {} as ResizeObserver);
  await settle(el);
}

/** Whether the child sits in the `…` menu rather than inline on the bar. */
function inMenu(el: DatagridFilterBar, id: string): boolean {
  return !!el.querySelector(`#${id}`)?.assignedSlot?.closest('anchored-popover');
}

function menuShown(el: DatagridFilterBar): boolean {
  return !el.shadowRoot?.querySelector('[aria-label="More"]')?.closest('[hidden]');
}

/** jsdom has no popover API, so the `…` panel is opened by stub; returns whether it is still open. */
async function openMenu(el: DatagridFilterBar): Promise<() => boolean> {
  const popover = el.shadowRoot?.querySelector<AnchoredPopover>('anchored-popover');
  await popover?.updateComplete;
  const panel = popover?.shadowRoot?.querySelector('.panel') as HTMLElement;
  let open = true;
  const matches = panel.matches.bind(panel);
  Object.defineProperty(panel, 'matches', {
    value: (selector: string) => (selector === ':popover-open' ? open : matches(selector)),
  });
  panel.hidePopover = () => void (open = false);
  return () => open;
}

describe('datagrid-filter-bar', () => {
  it('moves the lowest-priority sections into the more menu when the bar is too narrow', async () => {
    const el = await mount();
    await resize(el, NARROW);

    expect(inMenu(el, 'actions')).toBe(true);
    expect(inMenu(el, 'group')).toBe(true);
    expect(inMenu(el, 'global')).toBe(false);
    expect(inMenu(el, 'table-actions')).toBe(false);
    // The filters never move: they collapse into their own overflow toggle.
    expect(inMenu(el, 'filters')).toBe(false);
    expect(menuShown(el)).toBe(true);
  });

  it('returns every collapsed section to the bar when it widens again', async () => {
    const el = await mount();
    await resize(el, NARROW);
    expect(inMenu(el, 'actions')).toBe(true);

    await resize(el, WIDE);

    expect(['global', 'table-actions', 'group', 'actions'].some((id) => inMenu(el, id))).toBe(
      false,
    );
    expect(menuShown(el)).toBe(false);
  });

  it('keeps room for the filters toggle, and only when the bar has filters', async () => {
    // 540 fits every section (508px), but not with the filters' toggle beside them.
    const withFilters = await mount();
    await resize(withFilters, 540);
    expect(menuShown(withFilters)).toBe(true);
    withFilters.remove();

    const withoutFilters = await mount(['global', 'table-actions', 'group', 'actions']);
    await resize(withoutFilters, 540);
    expect(menuShown(withoutFilters)).toBe(false);
  });

  it('shows no more menu when only empty sections would not fit', async () => {
    const el = await mount(['global', 'filters']);
    await resize(el, 300);

    expect(menuShown(el)).toBe(false);
  });

  it('puts content that arrives in a collapsed section into the menu too', async () => {
    const el = await mount();
    await resize(el, NARROW);

    const late = document.createElement('div');
    late.id = 'late';
    late.setAttribute('slot', 'group');
    el.appendChild(late);
    await settle(el);

    // Left inline, the new picker would overlap the bar it was collapsed to save.
    expect(inMenu(el, 'late')).toBe(true);
  });

  it('collapses again when a section widens with no host resize', async () => {
    const el = await mount();
    await resize(el, NARROW);
    expect(inMenu(el, 'table-actions')).toBe(false);

    sectionWidths['table-actions'] = 200;
    await sectionResized(el);

    expect(inMenu(el, 'table-actions')).toBe(true);
  });

  it('keeps the view mode on the bar, compact, when even it no longer fits', async () => {
    const el = await mount();
    await resize(el, 240);

    // In the menu, the tab's current view mode could not be seen at all.
    expect(inMenu(el, 'global')).toBe(false);
    expect(el.querySelector('#global')?.hasAttribute('compact')).toBe(true);
    expect(inMenu(el, 'table-actions')).toBe(true);

    await resize(el, WIDE);
    expect(el.querySelector('#global')?.hasAttribute('compact')).toBe(false);
  });

  it('measures the view mode again when its content changes while compact', async () => {
    const el = await mount();
    await resize(el, 240);
    expect(el.querySelector('#global')?.hasAttribute('compact')).toBe(true);

    sectionWidths.global = 100;
    const replacement = document.createElement('div');
    replacement.setAttribute('slot', 'global');
    el.querySelector('#global')?.replaceWith(replacement);
    await settle(el);
    await sectionResized(el);

    // Judged on the old content's width, the narrower switch would stay compact.
    expect(replacement.hasAttribute('compact')).toBe(false);
  });

  it('keeps its layout while the tab is hidden', async () => {
    const el = await mount();
    await resize(el, NARROW);

    await resize(el, 0);

    expect(inMenu(el, 'actions')).toBe(true);
    expect(inMenu(el, 'global')).toBe(false);
  });

  it('closes the menu when everything fits again, so it cannot reopen by itself', async () => {
    const el = await mount();
    await resize(el, NARROW);
    const isOpen = await openMenu(el);

    await resize(el, WIDE);

    expect(isOpen()).toBe(false);
  });

  it('closes the menu when a command in it runs, but not when a picker in it opens', async () => {
    const el = await mount();
    await resize(el, NARROW);
    const isOpen = await openMenu(el);

    el.querySelector('#group')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    expect(isOpen()).toBe(true);

    const action = el.querySelector<ToolbarAction>('#actions');
    await action?.updateComplete;
    action?.shadowRoot?.querySelector('button')?.click();
    expect(isOpen()).toBe(false);
  });

  it('shows a collapsed action as a labelled row, not a bare icon', async () => {
    const el = await mount();
    await resize(el, NARROW);
    const action = el.querySelector<ToolbarAction>('#actions');
    await action?.updateComplete;

    const row = action?.shadowRoot?.querySelector('button.menu-row');
    expect(row?.textContent?.trim()).toBe('Export to CSV');
  });
});
