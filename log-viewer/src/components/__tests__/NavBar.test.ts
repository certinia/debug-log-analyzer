/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI / setFormValue).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-toolbar-button.js', () => ({}));
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

import type { LogIdentityData } from '../../features/app/logIdentity.js';
import type { IssueSeverity, LogIssue } from '../../features/notifications/types.js';

import { LogTitle } from '../LogTitle.js';
import type { NavBar } from '../NavBar.js';
import '../NavBar.js';

/** Drives the observed width, standing in for a panel drag. */
let notify: ((width: number) => void) | null = null;

class StubResizeObserver {
  private cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }

  observe(target: Element): void {
    // Only the nav bar's own observer drives the ladder — its descendants observe themselves
    // too (issue-list re-measures its clamps), and capturing theirs would hijack `notify`.
    if (target.tagName !== 'NAV-BAR') {
      return;
    }

    notify = (width) =>
      this.cb(
        [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
  }

  unobserve(): void {}
  disconnect(): void {}
}

/** The floor the ladder budgets around while the name is narrower. Stubbed, so `log-title`'s
 *  own `ch` value can change without moving every stage boundary here. */
const TITLE_FLOOR = 140;

/**
 * jsdom lays nothing out, so every `offsetWidth` is 0 and the ladder would never engage.
 * With these widths each chunk costs its width + the 6px gap, `•••` costs 36 and the title
 * holds its stubbed {@link TITLE_FLOOR}, putting the stage boundaries at
 * 598 / 542 / 476 / 390 / 284 / 248 / 212 px.
 */
const DEFAULT_CHUNK_WIDTHS: Readonly<Record<string, number>> = {
  'chunk--time': 50,
  'chunk--user': 60,
  'chunk--entry': 80,
  'chunk--meta': 100,
  'chunk--problems': 30,
  'chunk--inspector': 30,
  'chunk--bell': 30,
};

/** Mutable so a test can widen a chunk the way a new log's content does. */
let CHUNK_WIDTHS: Record<string, number> = { ...DEFAULT_CHUNK_WIDTHS };

beforeEach(() => {
  CHUNK_WIDTHS = { ...DEFAULT_CHUNK_WIDTHS };
});

const realFloorWidth = Object.getOwnPropertyDescriptor(LogTitle.prototype, 'floorWidth');

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = StubResizeObserver;
  // jsdom resolves no shadow-DOM CSS, so the real getter would read `auto` and fall back.
  Object.defineProperty(LogTitle.prototype, 'floorWidth', {
    configurable: true,
    get: () => TITLE_FLOOR,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.tagName === 'HEADER-MENU') {
        return 30;
      }
      for (const [className, width] of Object.entries(CHUNK_WIDTHS)) {
        if (this.classList.contains(className)) {
          return width;
        }
      }
      return 0;
    },
  });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  if (realFloorWidth) {
    Object.defineProperty(LogTitle.prototype, 'floorWidth', realFloorWidth);
  }
});

function issue(severity: IssueSeverity): LogIssue {
  return {
    summary: severity,
    message: '',
    severity,
    label: null,
    action: null,
    category: null,
    timestamp: null,
  };
}

async function mount(
  problems: readonly LogIssue[] = [],
  notifications: readonly LogIssue[] = [],
): Promise<NavBar> {
  const el = document.createElement('nav-bar') as NavBar;
  el.logName = 'test.log';
  el.logProblems = problems;
  el.notifications = notifications;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function resize(el: NavBar, width: number): Promise<NavBar> {
  notify?.(width);
  // One update to apply the new stage, a second for the re-fit it triggers.
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

function inlineChunks(el: NavBar): string[] {
  return ['meta', 'entry', 'user', 'time', 'problems', 'inspector', 'bell'].filter((chunk) =>
    el.shadowRoot?.querySelector(`.chunk--${chunk}`),
  );
}

function menuSections(el: NavBar): string[] {
  const menu = el.shadowRoot?.querySelector('[slot="collapsed"]');
  return Array.from(menu?.querySelectorAll('.menu-section__label, .menu-row span') ?? []).map(
    (n) => n.textContent?.trim() ?? '',
  );
}

/** The menu's Log details rows, as `label: value` plus `(hover)` where one is set. */
function detailRows(el: NavBar): string[] {
  const menu = el.shadowRoot?.querySelector('[slot="collapsed"]');
  return Array.from(menu?.querySelectorAll('.menu-details dt') ?? []).map((term) => {
    const value = term.nextElementSibling;
    const hover = value?.getAttribute('title');
    return `${term.textContent?.trim()}: ${value?.textContent?.trim()}${hover ? ` (${hover})` : ''}`;
  });
}

/** The cap nav-bar hands the title, in px. */
function titleMax(el: NavBar): number {
  const title = el.shadowRoot?.querySelector('log-title') as HTMLElement | null;
  return parseFloat(title?.style.getPropertyValue('--title-max') ?? '') || 0;
}

function marker(el: NavBar): boolean {
  const menu = el.shadowRoot?.querySelector('header-menu') as unknown as {
    marker: boolean;
  } | null;
  return menu?.marker ?? false;
}

describe('NavBar collapse ladder', () => {
  it('keeps everything inline when there is room', async () => {
    const el = await resize(await mount(), 800);

    expect(inlineChunks(el)).toEqual([
      'meta',
      'entry',
      'user',
      'time',
      'problems',
      'inspector',
      'bell',
    ]);
    expect(el.shadowRoot?.querySelector('[slot="collapsed"]')).toBeNull();
  });

  it('caps the title at the space every chunk leaves, so a shed never widens it', async () => {
    const el = await mount();

    // 422px of chunks and a 36px menu, whether a chunk is inline or in the menu.
    expect(titleMax(await resize(el, 700))).toBe(242);
    expect(titleMax(await resize(el, 560))).toBe(102);
    // 350px sheds meta, and the title keeps shrinking rather than taking its width.
    expect(titleMax(await resize(el, 350))).toBe(0);
  });

  it('sheds the identity one item at a time — time, then user, then entry', async () => {
    const el = await mount();

    expect(inlineChunks(await resize(el, 560))).toEqual([
      'meta',
      'entry',
      'user',
      'problems',
      'inspector',
      'bell',
    ]);
    expect(inlineChunks(await resize(el, 500))).toEqual([
      'meta',
      'entry',
      'problems',
      'inspector',
      'bell',
    ]);
    expect(inlineChunks(await resize(el, 420))).toEqual(['meta', 'problems', 'inspector', 'bell']);
    expect(el.shadowRoot?.querySelector('[slot="collapsed"]')).toBeNull();
  });

  it('then log meta, keeping its values in the title tooltip', async () => {
    const el = await resize(await mount(), 350);

    expect(inlineChunks(el)).toEqual(['problems', 'inspector', 'bell']);
    expect(el.shadowRoot?.querySelector('[slot="collapsed"]')).toBeNull();
  });

  it('folds the shed values into the menu, at full length', async () => {
    const el = await mount();
    el.logSize = 1_500_000;
    el.logDuration = 250_000_000;
    el.logIdentity = {
      entryPoint: { label: 'MyController.doIt', detail: 'apex://MyController/doIt' },
      user: { label: 'sam', detail: 'sam@example.com' },
      startTime: { label: '09:41:12', detail: '09:41:12 (Europe/London)' },
    };

    // 500px sheds the start time and the user, so only those two fold in.
    expect(detailRows(await resize(el, 500))).toEqual([
      'User: sam (sam@example.com)',
      'Started: 09:41:12 (09:41:12 (Europe/London))',
    ]);
    // 350px sheds every identity item and log meta too.
    expect(detailRows(await resize(el, 350))).toEqual([
      'Size: 1.5 MB',
      'Duration: 250 ms',
      'Entry point: MyController.doIt (apex://MyController/doIt)',
      'User: sam (sam@example.com)',
      'Started: 09:41:12 (09:41:12 (Europe/London))',
    ]);
    expect(menuSections(el)).toEqual(['Log details']);
  });

  it('budgets on the fallback floor until the title has been laid out', async () => {
    Object.defineProperty(LogTitle.prototype, 'floorWidth', { configurable: true, get: () => 0 });
    try {
      // The 88px fallback, not the 140 a laid-out title reports, so 560px still holds every chunk.
      expect(inlineChunks(await resize(await mount(), 560))).toEqual([
        'meta',
        'entry',
        'user',
        'time',
        'problems',
        'inspector',
        'bell',
      ]);
    } finally {
      Object.defineProperty(LogTitle.prototype, 'floorWidth', {
        configurable: true,
        get: () => TITLE_FLOOR,
      });
    }
  });

  it('gives a folded row no hover when the full value reads the same', async () => {
    const el = await mount();
    el.logIdentity = {
      entryPoint: null,
      user: { label: 'sam', detail: 'sam' },
      startTime: null,
    };

    expect(detailRows(await resize(el, 400))).toEqual(['User: sam']);
  });

  it('moves the bell into the menu next', async () => {
    const el = await resize(await mount([], [issue('warning')]), 270);

    expect(inlineChunks(el)).toEqual(['problems', 'inspector']);
    expect(menuSections(el)).toEqual(['Notifications (1)']);
  });

  it('then the Inspector toggle, as a command row', async () => {
    const el = await resize(await mount(), 230);

    expect(inlineChunks(el)).toEqual(['problems']);
    expect(menuSections(el)).toEqual(['Notifications', 'Toggle Inspector']);
  });

  it('sheds log problems last, and never the ••• menu', async () => {
    const el = await resize(await mount([issue('error'), issue('info')]), 180);

    expect(inlineChunks(el)).toEqual([]);
    expect(menuSections(el)).toEqual(['Notifications', 'Toggle Inspector', 'Log problems (2)']);
    expect(el.shadowRoot?.querySelector('header-menu')).not.toBeNull();
  });

  it('skips an identity item the log does not have, without freezing the ladder', async () => {
    const el = await mount();
    el.logIdentity = {
      entryPoint: { label: 'Anonymous Apex', detail: 'execute_anonymous_apex' },
      user: null,
      startTime: { label: '16:35:06', detail: 'Started 16:35:06.123' },
    } satisfies LogIdentityData;
    await el.updateComplete;
    await el.updateComplete;

    expect(inlineChunks(await resize(el, 800))).toEqual([
      'meta',
      'entry',
      'time',
      'problems',
      'inspector',
      'bell',
    ]);
    // The absent item costs nothing, so time survives narrower than it would with a user.
    expect(inlineChunks(await resize(el, 480))).toEqual([
      'meta',
      'entry',
      'problems',
      'inspector',
      'bell',
    ]);
  });

  it('folds the identity details into the title tooltip', async () => {
    const el = await mount();
    el.logIdentity = {
      entryPoint: { label: 'Anonymous Apex', detail: 'execute_anonymous_apex' },
      user: { label: 'tina.owen', detail: 'tina.owen@example.com' },
      startTime: { label: '16:35:06', detail: 'Started 16:35:06.123 (GMT+01:00)' },
    } satisfies LogIdentityData;
    await el.updateComplete;

    const details = el.shadowRoot?.querySelector('log-title')?.getAttribute('details') ?? '';
    expect(details).toContain('execute_anonymous_apex');
    expect(details).toContain('tina.owen@example.com');
    expect(details).toContain('Started 16:35:06.123 (GMT+01:00)');
  });

  it('re-measures a collapsed chunk after its content changes', async () => {
    CHUNK_WIDTHS['chunk--meta'] = 40;
    // 300px sheds meta at that width, so it has no box left to measure.
    const el = await resize(await mount(), 300);
    expect(inlineChunks(el)).toEqual(['problems', 'inspector', 'bell']);

    // A log loads: meta swaps its skeleton for real values and gets much wider.
    CHUNK_WIDTHS['chunk--meta'] = 200;
    el.logSize = 71_000_000;
    await el.updateComplete;
    await el.updateComplete;

    // 400px fits the *skeleton* width but not the real one — a stale cache would put
    // meta back inline and push the right-hand group off the edge.
    expect(inlineChunks(await resize(el, 400))).toEqual(['problems', 'inspector', 'bell']);
  });

  it('marks ••• once a collapsed section has content — presence, not severity', async () => {
    const el = await mount([issue('error')], [issue('warning')]);

    expect(marker(await resize(el, 800))).toBe(false);
    // The bell has left the header and it was carrying something.
    expect(marker(await resize(el, 270))).toBe(true);
    expect(marker(await resize(el, 180))).toBe(true);
  });

  it('leaves ••• unmarked when everything collapsed in is empty', async () => {
    const el = await mount([], []);

    expect(marker(await resize(el, 180))).toBe(false);
    expect(menuSections(el)).toEqual(['Notifications', 'Toggle Inspector', 'Log problems']);
  });
});
