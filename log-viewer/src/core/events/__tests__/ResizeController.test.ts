/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ResizeController } from '../ResizeController.js';
import { fakeHost } from './fakeHost.js';

type Callback = (entries: ResizeObserverEntry[]) => void;

const built: Array<{ callback: Callback; observed: Element[]; disconnects: number }> = [];

function stubResizeObserver(): void {
  built.length = 0;
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    private readonly _record: (typeof built)[number];
    constructor(callback: Callback) {
      this._record = { callback, observed: [], disconnects: 0 };
      built.push(this._record);
    }
    observe(element: Element): void {
      this._record.observed.push(element);
    }
    disconnect(): void {
      this._record.disconnects++;
    }
    unobserve(): void {}
  };
}

function entryFor(element: Element, width: number): ResizeObserverEntry {
  return { target: element, contentRect: { width } } as unknown as ResizeObserverEntry;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ResizeController', () => {
  it('observes the host on connect and releases it on disconnect', () => {
    stubResizeObserver();
    const host = fakeHost(document.createElement('div'));
    new ResizeController(host, () => {});

    expect(built).toHaveLength(0);

    host.connect();
    expect(built).toHaveLength(1);
    expect(built[0]?.observed).toEqual([host]);

    host.disconnect();
    expect(built[0]?.disconnects).toBe(1);
  });

  it('hands the callback the entries the observer reported', () => {
    stubResizeObserver();
    const host = fakeHost(document.createElement('div'));
    const widths: number[] = [];
    new ResizeController(host, (entries) => void widths.push(entries[0]?.contentRect.width ?? -1));

    host.connect();
    built[0]?.callback([entryFor(host, 320)]);

    expect(widths).toEqual([320]);
  });

  it('still calls back on an empty report, which a caller may act on', () => {
    stubResizeObserver();
    const host = fakeHost(document.createElement('div'));
    let calls = 0;
    new ResizeController(host, () => void calls++);

    host.connect();
    built[0]?.callback([]);

    expect(calls).toBe(1);
  });

  it('re-observes with the same observer after a re-attach', () => {
    stubResizeObserver();
    const host = fakeHost(document.createElement('div'));
    new ResizeController(host, () => {});

    host.connect();
    host.disconnect();
    host.connect();

    expect(built).toHaveLength(1);
    expect(built[0]?.observed).toEqual([host, host]);
  });
});
