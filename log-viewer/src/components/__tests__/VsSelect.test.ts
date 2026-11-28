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
  {
    disabled = [],
    descriptions = {},
  }: { disabled?: string[]; descriptions?: Record<string, string> } = {},
): Promise<{ el: VsSelect; changes: string[] }> {
  const el = document.createElement('vs-select') as VsSelect;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  for (const type of TYPES) {
    const option = document.createElement('vscode-option');
    option.textContent = type;
    option.selected = type === selected;
    option.disabled = disabled.includes(type);
    option.description = descriptions[type] ?? '';
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

describe('vs-select hover', () => {
  async function hoverThenEnter(label: string): Promise<string> {
    const { el } = await mount({}, 'DML_BEGIN', { disabled: ['METHOD_EXIT'] });
    el.open = true;
    await el.updateComplete;

    option(el, label).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    return el.value;
  }

  it('picks the hovered option on Enter', async () => {
    expect(await hoverThenEnter('METHOD_ENTRY')).toBe('METHOD_ENTRY');
  });

  it('ignores a hover on a disabled option, so Enter keeps the selection', async () => {
    expect(await hoverThenEnter('METHOD_EXIT')).toBe('DML_BEGIN');
  });
});

describe('vs-select descriptions', () => {
  it('gives each option its description for screen readers, and none to an option without one', async () => {
    const { el } = await mount({}, 'All', { descriptions: { DML_BEGIN: 'Inserts and updates' } });
    el.open = true;
    await el.updateComplete;

    expect(
      Object.fromEntries(
        TYPES.map((type) => [type, option(el, type).getAttribute('aria-description')]),
      ),
    ).toEqual({
      All: null,
      DML_BEGIN: 'Inserts and updates',
      METHOD_ENTRY: null,
      METHOD_EXIT: null,
    });
  });
});
