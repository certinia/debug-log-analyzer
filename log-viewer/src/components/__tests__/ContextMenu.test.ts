/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import type { ContextMenu, ContextMenuItem } from '../ContextMenu.js';
import '../ContextMenu.js';

const ITEMS: ContextMenuItem[] = [
  { id: 'copy', label: 'Copy' },
  { id: 'sep', label: '', separator: true },
  { id: 'paste', label: 'Paste', disabled: true },
  { id: 'columns', label: 'Columns', checked: true },
];

async function open(opener?: HTMLElement): Promise<ContextMenu> {
  const menu = document.createElement('context-menu') as ContextMenu;
  document.body.appendChild(menu);
  menu.show(ITEMS, 0, 0, opener);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await menu.updateComplete;
  return menu;
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function focusedLabel(menu: ContextMenu): string | null {
  return menu.shadowRoot?.activeElement?.querySelector('.label')?.textContent ?? null;
}

describe('ContextMenu', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('moves between the rows a user can pick, skipping separators and disabled rows', async () => {
    const menu = await open();
    expect(focusedLabel(menu)).toBe('Copy');

    press('ArrowDown');
    expect(focusedLabel(menu)).toBe('Columns');
    press('ArrowDown');
    expect(focusedLabel(menu)).toBe('Copy');
    press('ArrowUp');
    expect(focusedLabel(menu)).toBe('Columns');
  });

  it('picks the focused row with Enter', async () => {
    const menu = await open();
    let picked: string | undefined;
    menu.addEventListener('menu-select', (e) => {
      picked = (e as CustomEvent<{ itemId: string }>).detail.itemId;
    });

    press('End');
    press('Enter');

    expect(picked).toBe('columns');
  });

  // Else focus drops to the page, and the keyboard user has to find their place again.
  it('gives focus back to the button that opened it when closed with Escape', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const menu = await open(opener);

    press('Escape');

    expect(menu.isVisible()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('tells a screen reader whether a checkable row is on', async () => {
    const menu = await open();
    const row = menu.shadowRoot?.querySelector('[data-id="columns"]');

    expect(row?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row?.getAttribute('aria-checked')).toBe('true');
    expect(menu.shadowRoot?.querySelector('[data-id="copy"]')?.getAttribute('role')).toBe(
      'menuitem',
    );
  });
});
