/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

import type { HeaderMenu } from '../HeaderMenu.js';
import '../HeaderMenu.js';

async function mount(
  marker: boolean,
  collapsed = '',
  collapsedCount = collapsed ? 1 : 0,
): Promise<HeaderMenu> {
  const el = document.createElement('header-menu') as HeaderMenu;
  el.marker = marker;
  el.collapsedCount = collapsedCount;
  el.innerHTML = collapsed;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function rowLabels(el: HeaderMenu): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.filter-popover-row') ?? []).map(
    (n) => n.querySelector('span')?.textContent ?? '',
  );
}

describe('HeaderMenu', () => {
  it('always offers its own rows, so the toggle is never empty', async () => {
    expect(rowLabels(await mount(false))).toEqual(['Help & documentation', 'Report an issue']);
  });

  it('sends reporting through VS Code rather than a raw external href', async () => {
    const el = await mount(false);
    const href = el.shadowRoot?.querySelector('a.filter-popover-row')?.getAttribute('href') ?? '';

    expect(href.startsWith('command:vscode.open?')).toBe(true);
    expect(decodeURIComponent(href)).toContain('certinia/debug-log-analyzer/issues');
  });

  it('gives the link row the same face as the button row, links styling included', async () => {
    const el = await mount(false);
    const rows = Array.from(el.shadowRoot?.querySelectorAll('.filter-popover-row') ?? []);

    expect(rows.map((n) => n.tagName)).toEqual(['BUTTON', 'A']);
    expect(rows.every((n) => n.classList.contains('menu-row'))).toBe(true);
    // The shared face resets `a`'s link colour and underline; nothing may re-add them inline.
    expect(rows.some((n) => n.hasAttribute('style'))).toBe(false);
  });

  it('marks the toggle only when something has collapsed into it', async () => {
    expect((await mount(false)).shadowRoot?.querySelector('.toggle__marker')).toBeNull();

    const marked = await mount(true);
    expect(marked.shadowRoot?.querySelector('.toggle__marker')).not.toBeNull();
  });

  it('counts what it is holding in its label, marker or not', async () => {
    const label = (el: HeaderMenu) =>
      el.shadowRoot?.querySelector('.toggle')?.getAttribute('aria-label');

    expect(label(await mount(false))).toBe('More');
    // Collapsed with nothing to flag — the count is announced even without a marker.
    expect(label(await mount(false, '<span slot="collapsed">a</span>'))).toBe(
      'More — 1 collapsed item',
    );
    expect(label(await mount(true, '<span slot="collapsed">a</span>', 3))).toBe(
      'More — 3 collapsed items',
    );
  });

  it('closes when a collapsed command is used — light-dismiss only covers outside clicks', async () => {
    const el = await mount(false, '<button slot="collapsed">Toggle Inspector</button>');
    const popover = el.shadowRoot?.querySelector('anchored-popover') as unknown as {
      close: () => void;
    };
    const close = jest.fn();
    popover.close = close;

    // Chrome alone among the panel's contents: a click on it commands nothing.
    el.shadowRoot?.querySelector<HTMLElement>('.collapsed')?.click();
    expect(close).not.toHaveBeenCalled();

    el.querySelector<HTMLElement>('button[slot="collapsed"]')?.click();
    expect(close).toHaveBeenCalled();
  });

  it('frames the collapsed area only once something is slotted into it', async () => {
    const empty = await mount(false);
    expect(empty.shadowRoot?.querySelector('.collapsed--empty')).not.toBeNull();
    expect(empty.shadowRoot?.querySelector('divider-line')).toBeNull();

    const filled = await mount(false, '<span slot="collapsed">bell</span>');
    expect(filled.shadowRoot?.querySelector('.collapsed--empty')).toBeNull();
    expect(filled.shadowRoot?.querySelector('divider-line')).not.toBeNull();
  });

  it('leaves its panel untitled, as VS Code menus are', async () => {
    const el = await mount(false);
    const popover = el.shadowRoot?.querySelector('anchored-popover');

    expect(popover?.hasAttribute('show-heading')).toBe(false);
    expect(popover?.getAttribute('heading')).toBe('More');
  });
});
