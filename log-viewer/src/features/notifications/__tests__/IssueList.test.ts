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

jest.mock('../../call-tree/navigation.js', () => ({ goToRow: jest.fn() }));

import { goToRow } from '../../call-tree/navigation.js';

import type { IssueList } from '../components/IssueList.js';
import '../components/IssueList.js';

const goToRowMock = goToRow as jest.Mock;

function issue(
  severity: IssueSeverity,
  summary: string,
  eventIndex: number | null = null,
): LogIssue {
  return { summary, message: `${summary} detail`, severity, eventIndex, timestamp: null };
}

async function mount(issues: readonly LogIssue[]): Promise<IssueList> {
  const el = document.createElement('issue-list') as IssueList;
  el.issues = issues;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function summaries(el: IssueList): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.issue__summary') ?? []).map(
    (n) => n.textContent ?? '',
  );
}

describe('IssueList', () => {
  it('renders most severe first without mutating the input', async () => {
    const issues = [issue('info', 'skipped'), issue('error', 'limit exception')];
    const el = await mount(issues);

    expect(summaries(el)).toEqual(['limit exception', 'skipped']);
    expect(issues.map((i) => i.summary)).toEqual(['skipped', 'limit exception']);
  });

  it('offers call-tree navigation only for issues tied to an event', async () => {
    const el = await mount([issue('error', 'has event', 42), issue('warning', 'no event')]);

    const buttons = el.shadowRoot?.querySelectorAll('.issue__nav') ?? [];
    expect(buttons.length).toBe(1);

    (buttons[0] as HTMLElement).click();
    expect(goToRowMock).toHaveBeenCalledWith({ eventIndex: 42 });
  });
});
