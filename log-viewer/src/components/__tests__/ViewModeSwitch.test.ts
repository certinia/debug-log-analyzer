/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// vscode-button needs ElementInternals.setFormValue (absent in jsdom); skip its
// registration so `<vscode-button>` stays a plain element we can assert on.
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

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
});
