/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

import type { IssueSeverity, LogIssue } from '../types.js';

import type { NotificationCentre } from '../components/NotificationCentre.js';
import '../components/NotificationCentre.js';

function issue(severity: IssueSeverity): LogIssue {
  return {
    summary: severity,
    message: '',
    severity,
    action: null,
    category: null,
    timestamp: null,
  };
}

async function mount(issues: readonly LogIssue[]): Promise<NotificationCentre> {
  const el = document.createElement('notification-centre') as NotificationCentre;
  el.issues = issues;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function badge(el: NotificationCentre): HTMLElement | null {
  return el.shadowRoot?.querySelector('.header-control__badge') ?? null;
}

describe('NotificationCentre', () => {
  it('is a bell whatever the severity, so it cannot read as a second severity counter', async () => {
    const el = await mount([issue('error')]);

    expect(el.shadowRoot?.querySelector('.header-control vscode-icon')?.getAttribute('name')).toBe(
      'bell',
    );
  });

  it('has no badge when there is nothing to report', async () => {
    const el = await mount([]);

    expect(badge(el)).toBeNull();
    expect(el.shadowRoot?.querySelector('.header-control')?.getAttribute('aria-label')).toBe(
      'Notifications',
    );
  });

  it('badges the count and names the severities in its label', async () => {
    const el = await mount([issue('warning'), issue('error')]);

    expect(badge(el)?.textContent?.trim()).toBe('2');
    expect(el.shadowRoot?.querySelector('.header-control')?.getAttribute('aria-label')).toBe(
      '2 notifications — 1 error, 1 warning',
    );
  });
});
