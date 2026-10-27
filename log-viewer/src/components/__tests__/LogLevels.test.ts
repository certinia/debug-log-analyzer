/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// VsSelect extends vscode-single-select, whose setFormValue needs an
// ElementInternals jsdom lacks; the render would upgrade it.
jest.mock('../VsSelect.js', () => ({}));

import type { DebugLevels } from '../../core/log/levelFilter.js';
import type { LogLevels, LogLevelsChange } from '../LogLevels.js';
import '../LogLevels.js';

async function mount(captured: DebugLevels, chosen: DebugLevels): Promise<LogLevels> {
  const el = document.createElement('log-levels') as LogLevels;
  el.captured = captured;
  el.chosen = chosen;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function select(el: LogLevels): HTMLElement & { value: string } {
  const found = el.shadowRoot?.querySelector('vs-select');
  if (!found) {
    throw new Error('no select');
  }
  return found as HTMLElement & { value: string };
}

function options(el: LogLevels): HTMLElement[] {
  return [...select(el).querySelectorAll<HTMLElement>('vscode-option')];
}

describe('log-levels', () => {
  it('offers every level, coarsest first', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'FINE' });

    expect(options(el).map((option) => option.getAttribute('value'))).toEqual([
      'NONE',
      'ERROR',
      'WARN',
      'INFO',
      'DEBUG',
      'FINE',
      'FINER',
      'FINEST',
    ]);
  });

  it('disables a level finer than the log captured', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'FINE' });

    const disabled = options(el).filter((option) => option.hasAttribute('disabled'));

    expect(disabled.map((option) => option.getAttribute('value'))).toEqual(['FINER', 'FINEST']);
  });

  it('shows the level chosen', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'DEBUG' });

    expect(select(el).value).toBe('DEBUG');
    expect(options(el).find((option) => option.hasAttribute('selected'))?.textContent).toBe(
      'DEBUG',
    );
  });

  it('marks a category shown below the level it was captured at', async () => {
    const el = await mount(
      { apexCode: 'FINE', database: 'FINE' },
      { apexCode: 'DEBUG', database: 'FINE' },
    );

    const marked = [...(el.shadowRoot?.querySelectorAll('vs-select') ?? [])].map(
      (found) => (found as HTMLElement & { filterActive: boolean }).filterActive,
    );
    expect(marked).toEqual([true, false]);
  });

  it('shows the chosen level again when a pick is undone', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'FINE' });
    select(el).value = 'INFO';

    el.chosen = { apexCode: 'FINE' };
    el.requestUpdate();
    await el.updateComplete;

    expect(select(el).value).toBe('FINE');
  });

  it('asks for the level chosen', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'FINE' });
    const asked: LogLevelsChange[] = [];
    document.addEventListener('log-levels-change', (event) =>
      asked.push((event as CustomEvent<LogLevelsChange>).detail),
    );

    const target = select(el);
    target.value = 'INFO';
    target.dispatchEvent(new Event('change'));

    expect(asked).toEqual([{ category: 'apexCode', level: 'INFO' }]);
  });

  it('offers a reset only once a level is lowered', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'FINE' });
    const reset = el.shadowRoot?.querySelector<HTMLButtonElement>('button.reset');
    expect(reset?.disabled).toBe(true);

    el.chosen = { apexCode: 'DEBUG' };
    await el.updateComplete;

    expect(reset?.disabled).toBe(false);
    expect(reset?.getAttribute('aria-label')).toBe('Reset 1 lowered level to logged');
  });

  it('asks for the captured levels back', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'DEBUG' });
    let asked = 0;
    document.addEventListener('log-levels-reset', () => asked++);

    el.shadowRoot?.querySelector<HTMLElement>('button.reset')?.click();

    expect(asked).toBe(1);
  });

  it('names the captured level in each dropdown', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'DEBUG' });

    expect(select(el).getAttribute('hint')).toBe('logged');
    expect(select(el).getAttribute('hintValue')).toBe('FINE');
  });
});
