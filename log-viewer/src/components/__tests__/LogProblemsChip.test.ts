/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

import type { IssueSeverity, LogIssue } from '../../features/notifications/types.js';

import type { LogProblemsChip } from '../LogProblemsChip.js';
import '../LogProblemsChip.js';

function issue(severity: IssueSeverity): LogIssue {
  return { summary: severity, message: '', severity, eventIndex: null, timestamp: null };
}

async function mount(issues: readonly LogIssue[] | null): Promise<LogProblemsChip> {
  const el = document.createElement('log-problems') as LogProblemsChip;
  el.issues = issues;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function chip(el: LogProblemsChip): HTMLElement | null {
  return el.shadowRoot?.querySelector('.header-control') ?? null;
}

function face(el: LogProblemsChip): { icon: string | null; count: string; label: string | null } {
  const control = chip(el);
  return {
    icon: control?.querySelector('vscode-icon')?.getAttribute('name') ?? null,
    count: control?.querySelector('.header-control__badge')?.textContent?.trim() ?? '',
    label: control?.getAttribute('aria-label') ?? null,
  };
}

describe('LogProblemsChip', () => {
  it('shows a skeleton until the log has been parsed', async () => {
    const el = await mount(null);

    expect(el.shadowRoot?.querySelector('icon-button-skeleton')).not.toBeNull();
    expect(chip(el)).toBeNull();
  });

  it('shows a dimmed tick and no badge for a clean log', async () => {
    const el = await mount([]);

    expect(face(el)).toEqual({ icon: 'pass', count: '', label: 'No problems' });
    expect(chip(el)?.classList.contains('problems--clean')).toBe(true);
  });

  it('takes its glyph from the worst severity and its count from the total', async () => {
    const el = await mount([issue('error'), issue('warning'), issue('warning')]);

    expect(face(el)).toEqual({
      icon: 'error',
      count: '3',
      label: '3 problems — 1 error, 2 warnings',
    });
    expect(chip(el)?.classList.contains('problems--clean')).toBe(false);
  });

  it('falls back to the worst severity present when there is no error', async () => {
    expect(face(await mount([issue('warning'), issue('info')])).icon).toBe('warning');
    expect(face(await mount([issue('info')])).icon).toBe('info');
  });

  it('never tints the glyph — header chrome is monochrome', async () => {
    for (const severity of ['error', 'warning', 'info'] as const) {
      const control = chip(await mount([issue(severity)]));

      expect(control?.querySelector('vscode-icon')?.getAttribute('style')).toBeNull();
      expect(control?.getAttribute('style')).toBeNull();
    }
  });

  it('renders the issue list only when there is something to list', async () => {
    expect((await mount([])).shadowRoot?.querySelector('issue-list')).toBeNull();
    expect((await mount([issue('info')])).shadowRoot?.querySelector('issue-list')).not.toBeNull();
  });
});
