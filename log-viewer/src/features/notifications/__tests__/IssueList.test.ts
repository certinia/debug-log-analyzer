/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

import type { IssueAction, IssueSeverity, LogIssue } from '../types.js';

import type { IssueList } from '../components/IssueList.js';
import '../components/IssueList.js';

function issue(
  severity: IssueSeverity,
  summary: string,
  action: IssueAction | null = null,
  category: LogIssue['category'] = null,
): LogIssue {
  return { summary, message: `${summary} detail`, severity, action, category, timestamp: null };
}

async function mount(issues: readonly LogIssue[]): Promise<IssueList> {
  const el = document.createElement('issue-list') as IssueList;
  el.issues = issues;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function cards(el: IssueList): HTMLElement[] {
  return Array.from(el.shadowRoot?.querySelectorAll<HTMLElement>('.issue') ?? []);
}

function summaries(el: IssueList): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.issue__summary') ?? []).map(
    (n) => n.textContent ?? '',
  );
}

/**
 * jsdom has no layout, so nothing ever overflows its clamp. Stub the heights on the prototype
 * rather than on the node: expanding swaps the message element, and a per-node stub would go with
 * it, where real layout simply re-measures the same overflow.
 */
function stubOverflow(): void {
  restoreOverflow = ['scrollHeight', 'clientHeight'].map((name) => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      value: name === 'scrollHeight' ? 60 : 30,
      configurable: true,
    });

    return () =>
      original
        ? Object.defineProperty(HTMLElement.prototype, name, original)
        : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
}

let restoreOverflow: Array<() => unknown> = [];

afterEach(() => {
  restoreOverflow.forEach((restore) => restore());
  restoreOverflow = [];
});

/** Fires every observer the suite's components have registered, standing in for a popover open. */
let resize: (() => void) | null = null;

class CapturingResizeObserver implements ResizeObserver {
  private readonly cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }

  observe(): void {
    resize = () => this.cb([], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = CapturingResizeObserver;
});

describe('IssueList', () => {
  it('renders most severe first without mutating the input', async () => {
    const issues = [issue('info', 'skipped'), issue('error', 'limit exception')];
    const el = await mount(issues);

    expect(summaries(el)).toEqual(['limit exception', 'skipped']);
    expect(issues.map((i) => i.summary)).toEqual(['skipped', 'limit exception']);
  });

  it('renders a meta line with the kind pill and the moment in the log', async () => {
    const el = await mount([
      { ...issue('error', 'cpu limit'), label: 'Fatal error', timestamp: 100_000_000 },
      issue('info', 'skipped'),
    ]);

    const meta = cards(el)[0]?.querySelector('.issue__meta');
    expect(meta?.querySelector('.issue__label')?.textContent).toBe('Fatal error');
    expect(meta?.textContent?.replace(/\s+/g, ' ')).toContain('· 100 ms');
    // The meta line lives under the head, so the summary's clamp keeps the full width.
    expect(cards(el)[0]?.querySelector('.issue__head .issue__label')).toBeNull();
    // Meta is part of the card's accessible name, since the row is presentation.
    expect(cards(el)[0]?.getAttribute('aria-label')).toBe('cpu limit (Fatal error, 100 ms)');
    // No label and no timestamp — no meta row at all.
    expect(cards(el)[1]?.querySelector('.issue__meta')).toBeNull();
  });

  it('shows a time-only meta line, including for a timestamp of 0', async () => {
    const el = await mount([{ ...issue('warning', 'truncated'), timestamp: 0 }]);

    const meta = cards(el)[0]?.querySelector('.issue__meta');
    expect(meta?.querySelector('.issue__label')).toBeNull();
    expect(meta?.textContent).not.toContain('·');
    expect(meta?.textContent?.replace(/\s+/g, ' ')).toContain('0 ms');
    expect(cards(el)[0]?.getAttribute('aria-label')).toBe('truncated (0 ms)');
  });

  it('activates by clicking the card and by the keyboard-reachable action button', async () => {
    const run = jest.fn();
    const el = await mount([issue('error', 'has action', { label: 'Go somewhere', run })]);

    // The card is a group so its message can be a button: a control inside a control is
    // neither valid ARIA nor navigable.
    const [card] = cards(el);
    expect(card?.getAttribute('role')).toBe('group');
    expect(card?.hasAttribute('tabindex')).toBe(false);
    expect(card?.getAttribute('title')).toBe('has action — Go somewhere');
    expect(card?.getAttribute('aria-label')).toBe('has action — Go somewhere');

    card?.click();
    expect(run).toHaveBeenCalledTimes(1);

    // action-icon renders a real button, whose accessible name comes from `label`.
    const go = el.shadowRoot?.querySelector<HTMLElement>('vscode-icon.issue__go');
    expect(go?.hasAttribute('action-icon')).toBe(true);
    expect(go?.getAttribute('label')).toBe('Go somewhere');
    expect(go?.getAttribute('name')).toBe('arrow-right');

    // Its click bubbles to the card's single handler, so activation runs the action once.
    go?.click();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('puts the action button on the summary line, not below the message', async () => {
    const el = await mount([
      issue('error', 'has action', { label: 'Go somewhere', run: jest.fn() }),
    ]);

    const head = el.shadowRoot?.querySelector('.issue__head');
    expect(head?.querySelector('.issue__summary')).not.toBeNull();
    expect(head?.querySelector('vscode-icon.issue__go')).not.toBeNull();
  });

  it('uses the action icon when one is supplied', async () => {
    const el = await mount([
      issue('warning', 'report me', { label: 'Report', icon: 'link-external', run: jest.fn() }),
    ]);

    expect(el.shadowRoot?.querySelector('vscode-icon.issue__go')?.getAttribute('name')).toBe(
      'link-external',
    );
  });

  it('leaves an action-less card static, with no affordance', async () => {
    const el = await mount([issue('info', 'skipped')]);

    const [card] = cards(el);
    expect(card?.getAttribute('role')).toBe('group');
    expect(card?.classList.contains('issue--action')).toBe(false);
    expect(el.shadowRoot?.querySelector('.issue__go')).toBeNull();
  });

  it('leaves a message that fits as plain text, not a toggle', async () => {
    const el = await mount([issue('info', 'skipped')]);

    expect(el.shadowRoot?.querySelector('span.issue__message')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('button.issue__message')).toBeNull();
  });

  it('toggles a clipped message on click without activating the card', async () => {
    stubOverflow();
    const run = jest.fn();
    const el = await mount([issue('error', 'long', { label: 'Go somewhere', run })]);
    // A second settle: the first render's `updated()` is what measures the overflow, and the
    // state it sets is what turns the message into a toggle.
    await el.updateComplete;

    const message = el.shadowRoot?.querySelector<HTMLElement>('button.issue__message');
    expect(message?.getAttribute('aria-expanded')).toBe('false');

    message?.click();
    await el.updateComplete;

    expect(run).not.toHaveBeenCalled();
    const expanded = el.shadowRoot?.querySelector<HTMLElement>('button.issue__message');
    expect(expanded?.getAttribute('aria-expanded')).toBe('true');
    expect(expanded?.classList.contains('issue__clamp')).toBe(false);

    expanded?.click();
    await el.updateComplete;

    expect(run).not.toHaveBeenCalled();
    expect(
      el.shadowRoot?.querySelector('button.issue__message')?.classList.contains('issue__clamp'),
    ).toBe(true);
  });

  it('re-measures when it is given a size, since both popovers render it closed', async () => {
    const el = await mount([issue('error', 'long', { label: 'Go somewhere', run: jest.fn() })]);

    // No layout yet — as inside a closed popover, where measuring would find nothing clipped.
    expect(el.shadowRoot?.querySelector('button.issue__message')).toBeNull();

    stubOverflow();
    resize?.();
    await el.updateComplete;
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button.issue__message')).not.toBeNull();
  });

  it('titles both the action button and the message toggle', async () => {
    stubOverflow();
    const el = await mount([issue('error', 'long', { label: 'Go somewhere', run: jest.fn() })]);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('vscode-icon.issue__go')?.getAttribute('title')).toBe(
      'Go somewhere',
    );

    const message = el.shadowRoot?.querySelector<HTMLElement>('button.issue__message');
    expect(message?.getAttribute('title')).toBe('Show more');

    message?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button.issue__message')?.getAttribute('title')).toBe(
      'Show less',
    );
  });

  it('forgets what was expanded when it is given a new list', async () => {
    stubOverflow();
    const el = await mount([issue('error', 'long')]);
    await el.updateComplete;
    el.shadowRoot?.querySelector<HTMLElement>('button.issue__message')?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('button.issue__message')).not.toBeNull();

    // Both sets are index-keyed and the element is reused across log loads, so index 0 is now
    // a different issue — one whose message fits.
    restoreOverflow.forEach((restore) => restore());
    restoreOverflow = [];
    el.issues = [issue('info', 'fits')];
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button.issue__message')).toBeNull();
    expect(el.shadowRoot?.querySelector('span.issue__message')).not.toBeNull();
  });

  it('does not activate the card when the click ends a text selection', async () => {
    const run = jest.fn();
    const el = await mount([issue('error', 'selectable', { label: 'Go somewhere', run })]);

    const selection = document.getSelection();
    selection?.selectAllChildren(document.body);
    cards(el)[0]?.click();
    expect(run).not.toHaveBeenCalled();

    selection?.removeAllRanges();
    cards(el)[0]?.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rails on the timeline colour when the issue has a category, else its severity', async () => {
    const el = await mount([issue('error', 'fatal', null, 'exception'), issue('info', 'skipped')]);

    const rails = Array.from(el.shadowRoot?.querySelectorAll<HTMLElement>('.issue__rail') ?? []);
    expect(rails[0]?.style.backgroundColor).toBe('rgb(229, 72, 77)');
    expect(rails[1]?.getAttribute('style')).toContain('var(--vscode-editorInfo-foreground)');
  });
});
