/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TimelineResizeHandler } from '../TimelineResizeHandler.js';

describe('TimelineResizeHandler devicePixelRatio watching', () => {
  let queries: { media: string; fire: () => void }[];
  let renderer: { resize: jest.Mock<(width: number, height: number) => void> };
  let container: HTMLElement;

  function setRatio(value: number): void {
    Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
  }

  function setBox(width: number, height: number): void {
    container.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  }

  beforeEach(() => {
    queries = [];
    renderer = { resize: jest.fn<(width: number, height: number) => void>() };
    container = document.createElement('div');
    setBox(400, 364);
    setRatio(1);

    window.matchMedia = ((media: string) => {
      let listener: (() => void) | null = null;
      queries.push({ media, fire: () => listener?.() });
      return {
        addEventListener: (_type: string, handler: () => void) => (listener = handler),
        removeEventListener: () => (listener = null),
      };
    }) as unknown as typeof window.matchMedia;
  });

  it('re-renders the measured box on a ratio change, then re-arms on the new ratio', () => {
    new TimelineResizeHandler(container, renderer).setupResizeObserver();
    expect(queries[0]?.media).toBe('(resolution: 1dppx)');

    setBox(500, 420);
    setRatio(2);
    queries[0]?.fire();

    expect(renderer.resize).toHaveBeenCalledWith(500, 420);
    expect(queries[1]?.media).toBe('(resolution: 2dppx)');
  });

  it('stops watching once destroyed', () => {
    const handler = new TimelineResizeHandler(container, renderer);
    handler.setupResizeObserver();

    handler.destroy();
    queries[0]?.fire();

    expect(renderer.resize).not.toHaveBeenCalled();
  });
});
