/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { GridExpansion } from '../../grid/index.js';
import type { ExpandableGrid, TreeExpandButton } from '../TreeExpandButton.js';
import '../TreeExpandButton.js';

interface FakeGrid extends Omit<ExpandableGrid, 'expansion'> {
  expansion: GridExpansion;
  calls: string[];
  send(canExpand: boolean, canCollapse: boolean): Promise<void>;
}

/** Stands in for an lv-grid: records calls and sends its expansion when told. */
function fakeGrid(canExpand: boolean, canCollapse: boolean): FakeGrid {
  const grid = document.createElement('div') as unknown as FakeGrid;
  grid.tabIndex = 0;
  grid.calls = [];
  grid.expansion = { canExpand, canCollapse };
  grid.expandLevel = async () => void grid.calls.push('expand');
  grid.collapseLevel = async () => void grid.calls.push('collapse');
  grid.expandAll = async () => void grid.calls.push('expand all');
  grid.collapseAll = async () => void grid.calls.push('collapse all');
  document.body.append(grid);
  return grid;
}

async function mount(grid: FakeGrid): Promise<TreeExpandButton> {
  const el = document.createElement('tree-expand-button');
  el.grid = grid;
  document.body.appendChild(el);
  await el.updateComplete;
  grid.send = async (canExpand, canCollapse) => {
    grid.expansion = { canExpand, canCollapse };
    grid.dispatchEvent(new CustomEvent('lv-grid-expansion-change', { detail: grid.expansion }));
    await el.updateComplete;
  };
  return el;
}

const main = (el: TreeExpandButton): HTMLButtonElement =>
  el.shadowRoot?.querySelector('button') as HTMLButtonElement;

const more = (el: TreeExpandButton): HTMLButtonElement =>
  el.shadowRoot?.querySelector('.more') as HTMLButtonElement;

const focused = (el: TreeExpandButton): string | undefined =>
  el.shadowRoot?.activeElement?.textContent?.trim();

/** jsdom has no popover API, so open and close send the toggle event a browser would. */
function stubPopover(el: TreeExpandButton): HTMLElement {
  const menu = el.shadowRoot?.querySelector('#menu') as HTMLElement;
  let open = false;
  const send = (next: boolean) => {
    open = next;
    menu.dispatchEvent(Object.assign(new Event('toggle'), { newState: next ? 'open' : 'closed' }));
  };
  menu.showPopover = () => send(true);
  menu.hidePopover = () => send(false);
  // What `popovertarget` does once the chevron's own click handler has run.
  more(el).addEventListener('click', () => send(!open));
  return menu;
}

const press = (target: Element, key: string): void =>
  void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

const item = (el: TreeExpandButton, label: string): HTMLElement | undefined =>
  [...(el.shadowRoot?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
    (row) => row.textContent?.trim() === label,
  );

describe('TreeExpandButton', () => {
  it('expands until no row is closed, then collapses until no row is open', async () => {
    const grid = fakeGrid(true, false);
    const el = await mount(grid);
    main(el).click();
    await grid.send(true, true);
    main(el).click();
    await grid.send(false, true);
    expect(main(el).getAttribute('aria-label')).toBe('Collapse One Level');
    main(el).click();
    await grid.send(true, true);
    main(el).click();
    await grid.send(true, false);
    expect(main(el).getAttribute('aria-label')).toBe('Expand One Level');
    expect(grid.calls).toEqual(['expand', 'expand', 'collapse', 'collapse']);
  });

  it('keeps each grid its own direction', async () => {
    const grid = fakeGrid(true, false);
    const el = await mount(grid);
    await grid.send(false, true);
    await grid.send(true, true);
    el.grid = fakeGrid(true, false);
    await el.updateComplete;
    expect(main(el).getAttribute('aria-label')).toBe('Expand One Level');
    el.grid = grid;
    await el.updateComplete;
    expect(main(el).getAttribute('aria-label')).toBe('Collapse One Level');
  });

  it('stops following a grid it no longer has', async () => {
    const old = fakeGrid(true, false);
    const el = await mount(old);
    const grid = fakeGrid(true, false);
    el.grid = grid;
    await el.updateComplete;
    grid.expansion = { canExpand: false, canCollapse: true };
    await old.send(true, true);
    expect(main(el).getAttribute('aria-label')).toBe('Expand One Level');
  });

  it('disables both halves when no row can open or close, or there is no grid', async () => {
    const el = await mount(fakeGrid(false, false));
    expect([main(el).disabled, more(el).disabled]).toEqual([true, true]);
    el.grid = null;
    await el.updateComplete;
    expect([main(el).disabled, more(el).disabled]).toEqual([true, true]);
  });

  it('greys out Expand All once every row is open', async () => {
    const grid = fakeGrid(false, true);
    const el = await mount(grid);
    expect(item(el, 'Expand All')?.getAttribute('aria-disabled')).toBe('true');
    item(el, 'Expand All')?.click();
    expect(grid.calls).toEqual([]);
  });

  it('opens its menu from the arrow keys and moves through it', async () => {
    const el = await mount(fakeGrid(true, true));
    const menu = stubPopover(el);
    press(more(el), 'ArrowUp');
    expect(focused(el)).toBe('Collapse All');
    press(menu, 'ArrowDown');
    expect(focused(el)).toBe('Expand All');
    press(menu, 'End');
    expect(focused(el)).toBe('Collapse All');
    press(menu, 'Home');
    expect(focused(el)).toBe('Expand All');
    press(more(el), 'ArrowDown');
    expect(focused(el)).toBe('Expand All');
  });

  it('focuses a menu row on open only when a key opened it', async () => {
    const el = await mount(fakeGrid(true, true));
    const menu = stubPopover(el);
    more(el).dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(el.shadowRoot?.activeElement).toBe(menu);
    press(menu, 'ArrowUp');
    expect(focused(el)).toBe('Collapse All');
    press(menu, 'Escape');
    more(el).click();
    expect(focused(el)).toBe('Expand All');
  });

  it('closes its menu on Escape, back to the chevron, and on Tab', async () => {
    const el = await mount(fakeGrid(true, true));
    const menu = stubPopover(el);
    more(el).click();
    await el.updateComplete;
    expect(more(el).getAttribute('aria-expanded')).toBe('true');
    press(menu, 'Escape');
    await el.updateComplete;
    expect(more(el).getAttribute('aria-expanded')).toBe('false');
    expect(el.shadowRoot?.activeElement).toBe(more(el));
    more(el).click();
    press(menu, 'Tab');
    await el.updateComplete;
    expect(more(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('closes its menu from the chevron that opened it', async () => {
    const el = await mount(fakeGrid(true, true));
    stubPopover(el);
    more(el).click();
    more(el).click();
    await el.updateComplete;
    expect(more(el).getAttribute('aria-expanded')).toBe('false');
    expect(more(el).getAttribute('popovertarget')).toBe('menu');
  });

  it.each([
    ['Expand All', 'expand all'],
    ['Collapse All', 'collapse all'],
  ])('runs %s from its menu, then gives focus to the grid', async (label, call) => {
    const grid = fakeGrid(true, true);
    const el = await mount(grid);
    item(el, label)?.click();
    await el.updateComplete;
    expect(grid.calls).toEqual([call]);
    expect(document.activeElement).toBe(grid);
  });
});
