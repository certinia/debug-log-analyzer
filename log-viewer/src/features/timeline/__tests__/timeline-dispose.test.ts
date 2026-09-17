/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';

import { dispose, init } from '../services/Timeline.js';

/** The find events the legacy chart listens for on `document`. */
const FIND_EVENTS = ['lv-find', 'lv-find-match', 'lv-find-close'];

function countFindListeners(calls: unknown[][]): number {
  return calls.filter(([name]) => FIND_EVENTS.includes(name as string)).length;
}

/** The container the chart draws into; jsdom gives no 2d context, which init tolerates. */
function container(): HTMLElement {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.id = 'timeline';
  host.appendChild(canvas);
  document.body.appendChild(host);
  return host;
}

const emptyLog = { children: [], duration: { self: 0, total: 0 } } as unknown as ApexLog;

describe('legacy timeline listener lifetime', () => {
  let added: jest.SpiedFunction<typeof document.addEventListener>;
  let removed: jest.SpiedFunction<typeof document.removeEventListener>;

  beforeEach(() => {
    added = jest.spyOn(document, 'addEventListener');
    removed = jest.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    dispose();
    added.mockRestore();
    removed.mockRestore();
    document.body.replaceChildren();
  });

  it('listens for the find events once the chart is built', () => {
    init(container(), emptyLog);

    expect(countFindListeners(added.mock.calls)).toBe(FIND_EVENTS.length);
  });

  it('stops listening when the host goes', () => {
    init(container(), emptyLog);

    dispose();

    expect(countFindListeners(removed.mock.calls)).toBe(FIND_EVENTS.length);
  });

  it('does not stack listeners when the legacy toggle swaps the chart back in', () => {
    // Each init used to add three more, so toggling legacy on and off accumulated
    // handlers that outlived the element and still answered a search.
    init(container(), emptyLog);
    init(container(), emptyLog);
    init(container(), emptyLog);

    const live = countFindListeners(added.mock.calls) - countFindListeners(removed.mock.calls);
    expect(live).toBe(FIND_EVENTS.length);
  });
});
