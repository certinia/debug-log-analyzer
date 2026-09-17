/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A ratio change resizes nothing, so the ResizeObserver never fires and only the watcher sees it. */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TimelineResizeHandler } from '../TimelineResizeHandler.js';

class FakeMediaQueryList {
  public listener: (() => void) | null = null;
  public once = false;
  public readonly media: string;

  constructor(media: string) {
    this.media = media;
  }

  addEventListener(_type: string, listener: () => void, options?: { once?: boolean }): void {
    this.listener = listener;
    this.once = options?.once ?? false;
  }

  removeEventListener(): void {
    this.listener = null;
  }

  fire(): void {
    const listener = this.listener;
    if (this.once) {
      this.listener = null;
    }
    listener?.();
  }
}

describe('TimelineResizeHandler devicePixelRatio watching', () => {
  const realDevicePixelRatio = window.devicePixelRatio;
  let queries: FakeMediaQueryList[];
  let renderer: { resize: jest.Mock<(width: number, height: number) => void> };
  let container: HTMLElement;

  function setRatio(value: number): void {
    Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
  }

  beforeEach(() => {
    queries = [];
    renderer = { resize: jest.fn<(width: number, height: number) => void>() };
    container = document.createElement('div');
    container.getBoundingClientRect = () => ({ width: 400, height: 364 }) as DOMRect;

    setRatio(1);
    (globalThis as unknown as Record<string, unknown>)['matchMedia'] = (media: string) => {
      const query = new FakeMediaQueryList(media);
      queries.push(query);
      return query;
    };
  });

  afterEach(() => {
    setRatio(realDevicePixelRatio);
    delete (globalThis as unknown as Record<string, unknown>)['matchMedia'];
  });

  it('binds the query to the ratio in force, since no event reports a change', () => {
    setRatio(1.25);
    new TimelineResizeHandler(container, renderer).setupResizeObserver();

    expect(queries).toHaveLength(1);
    expect(queries[0]?.media).toBe('(resolution: 1.25dppx)');
  });

  it('re-renders at the current size and re-arms on the new ratio', () => {
    new TimelineResizeHandler(container, renderer).setupResizeObserver();

    setRatio(2);
    queries[0]?.fire();

    // The box is unchanged here; `resize` re-reads the ratio itself and acts on that.
    expect(renderer.resize).toHaveBeenNthCalledWith(1, 400, 364);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.media).toBe('(resolution: 2dppx)');

    setRatio(3);
    queries[1]?.fire();
    expect(renderer.resize).toHaveBeenCalledTimes(2);
  });

  // A zoom step moves the ratio and the box together, and the watcher runs first. Replaying the
  // size measured before the zoom would paint a dead box, then paint again for the observer.
  it('re-measures rather than replaying the size it last saw', () => {
    const handler = new TimelineResizeHandler(container, renderer);
    handler.setupResizeObserver();

    container.getBoundingClientRect = () => ({ width: 500, height: 420 }) as DOMRect;
    setRatio(2);
    queries[0]?.fire();

    expect(renderer.resize).toHaveBeenCalledWith(500, 420);
  });

  it('leaves a fired query inert, so the re-arm cannot double up', () => {
    new TimelineResizeHandler(container, renderer).setupResizeObserver();

    setRatio(2);
    queries[0]?.fire();
    queries[0]?.fire();

    expect(renderer.resize).toHaveBeenCalledTimes(1);
  });

  it('waits for a measurement rather than resizing to nothing', () => {
    container.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    new TimelineResizeHandler(container, renderer).setupResizeObserver();

    setRatio(2);
    queries[0]?.fire();

    expect(renderer.resize).not.toHaveBeenCalled();
  });

  it('stops watching once destroyed', () => {
    const handler = new TimelineResizeHandler(container, renderer);
    handler.setupResizeObserver();

    handler.destroy();
    setRatio(2);
    queries[0]?.fire();

    expect(renderer.resize).not.toHaveBeenCalled();
  });
});
