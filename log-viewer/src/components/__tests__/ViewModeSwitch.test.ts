/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { ViewModeSwitch } from '../ViewModeSwitch.js';
import '../ViewModeSwitch.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function buttons(el: ViewModeSwitch): HTMLElement[] {
  return Array.from(el.shadowRoot?.querySelectorAll('vscode-button') ?? []) as HTMLElement[];
}

async function mount(value = 'a'): Promise<ViewModeSwitch> {
  const el = document.createElement('view-mode-switch') as ViewModeSwitch;
  el.options = OPTIONS;
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('ViewModeSwitch', () => {
  it('renders one button per option and marks the active one non-secondary', async () => {
    const el = await mount('b');
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(buttons(el).map((b) => b.hasAttribute('secondary'))).toEqual([true, false, true]);
  });

  it('emits view-mode-change with the clicked value, but not for the active one', async () => {
    const el = await mount('a');
    const seen: string[] = [];
    el.addEventListener('view-mode-change', (e) =>
      seen.push((e as CustomEvent<{ value: string }>).detail.value),
    );

    buttons(el)[2]?.click(); // Gamma
    buttons(el)[0]?.click(); // Alpha (already active — no event)
    expect(seen).toEqual(['c']);
  });

  it('compact, shows the label and emits the value of the picked mode', async () => {
    const el = await mount('a');
    el.compact = true;
    await el.updateComplete;
    const seen: string[] = [];
    el.addEventListener('view-mode-change', (e) =>
      seen.push((e as CustomEvent<{ value: string }>).detail.value),
    );

    const picker = el.shadowRoot?.querySelector('vs-select') as HTMLInputElement;
    expect(picker.value).toBe('Alpha');
    picker.value = 'Gamma';
    picker.dispatchEvent(new Event('change'));

    // The picker speaks in labels; a label sent on would match no mode.
    expect(seen).toEqual(['c']);
    // One combobox, so no longer a radiogroup, but still a named group.
    expect(el.getAttribute('role')).toBe('group');
  });
});
