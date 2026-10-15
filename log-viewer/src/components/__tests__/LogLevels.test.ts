/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import { ContextProvider } from '@lit/context';
import type { ApexLog, DebugLevels } from '@apexdevtools/apex-log-parser';

// VsSelect extends vscode-single-select, whose setFormValue needs an
// ElementInternals jsdom lacks; the render would upgrade it.
jest.mock('../VsSelect.js', () => ({}));

import { logContext } from '../../core/log/logContext.js';
import { logStoreFor } from '../../core/log/LogStore.js';
import type { LogLevels, LogLevelsChange } from '../LogLevels.js';
import '../LogLevels.js';

async function mount(captured: DebugLevels, shown: DebugLevels): Promise<LogLevels> {
  const host = document.createElement('div');
  const log = { debugLevels: shown } as ApexLog;
  new ContextProvider(host, { context: logContext, initialValue: logStoreFor(log) });
  document.body.appendChild(host);

  const el = document.createElement('log-levels') as LogLevels;
  el.captured = captured;
  host.appendChild(el);
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

  it('shows the level of the log on screen', async () => {
    const el = await mount({ apexCode: 'FINE' }, { apexCode: 'DEBUG' });

    expect(select(el).value).toBe('DEBUG');
    expect(options(el).find((option) => option.hasAttribute('selected'))?.textContent).toBe(
      'DEBUG',
    );
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
});
