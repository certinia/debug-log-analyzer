/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

// What vscode-single-select needs that jsdom lacks.
HTMLElement.prototype.attachInternals = function () {
  return { setFormValue() {}, setValidity() {}, form: null } as unknown as ElementInternals;
};
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  get(this: HTMLElement) {
    return this.textContent ?? '';
  },
});
HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};

import '#vscode-elements/vscode-option.js';
import type { VsSelect } from '../VsSelect.js';
import '../VsSelect.js';

const TYPES = ['All', 'DML_BEGIN', 'METHOD_ENTRY', 'METHOD_EXIT'];

async function mount(
  attrs: Record<string, string> = {},
  selected = 'All',
): Promise<{ el: VsSelect; changes: string[] }> {
  const el = document.createElement('vs-select') as VsSelect;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  for (const type of TYPES) {
    const option = document.createElement('vscode-option');
    option.textContent = type;
    option.selected = type === selected;
    el.append(option);
  }
  document.body.append(el);
  // The options reach the select on slotchange, a task after the first render.
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const changes: string[] = [];
  el.addEventListener('change', () => changes.push(el.value));
  return { el, changes };
}

function option(el: VsSelect, label: string): HTMLElement {
  const found = [...(el.shadowRoot?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
    (li) => li.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`no option ${label}`);
  }
  return found;
}

async function pick(el: VsSelect, label: string): Promise<void> {
  el.open = true;
  await el.updateComplete;
  option(el, label).click();
  await el.updateComplete;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('vs-select deselectValue', () => {
  // A combobox, as the Call Tree's Type filter is.
  const filter = { deselectValue: 'All', combobox: '' };

  it('goes back to the deselect value when the selected option is clicked again', async () => {
    const { el, changes } = await mount(filter, 'DML_BEGIN');

    await pick(el, 'DML_BEGIN');

    expect(el.value).toBe('All');
    expect(changes).toEqual(['All']);
  });

  it('goes back to the deselect value on Enter on the selected option', async () => {
    const { el, changes } = await mount(filter, 'DML_BEGIN');
    el.open = true;
    await el.updateComplete;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    expect(el.value).toBe('All');
    expect(changes).toEqual(['All']);
  });

  it('picks a different option as usual', async () => {
    const { el, changes } = await mount(filter, 'DML_BEGIN');

    await pick(el, 'METHOD_ENTRY');

    expect(el.value).toBe('METHOD_ENTRY');
    expect(changes).toEqual(['METHOD_ENTRY']);
  });

  it('keeps the selected option when picked again with no deselect value', async () => {
    const { el } = await mount({}, 'DML_BEGIN');

    await pick(el, 'DML_BEGIN');

    expect(el.value).toBe('DML_BEGIN');
  });
});
