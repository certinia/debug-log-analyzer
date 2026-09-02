/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { eventBus } from '../EventBus.js';

describe('eventBus.onSource', () => {
  it('hands over an event that names the source, and nothing else', () => {
    const seen: number[] = [];
    const off = eventBus.onSource('inspector:reveal', 'calltree', (detail) => {
      seen.push(detail.eventIndex);
    });

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 4 });
    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: 5 });

    off();
    expect(seen).toEqual([4]);
  });

  it('gives one event to the tab that names it and to no other', () => {
    const seen: string[] = [];
    const offTimeline = eventBus.onSource('inspector:locate', 'timeline', () => {
      seen.push('timeline');
    });
    const offCalltree = eventBus.onSource('inspector:locate', 'calltree', () => {
      seen.push('calltree');
    });

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4], sticky: false });

    offTimeline();
    offCalltree();
    expect(seen).toEqual(['calltree']);
  });

  it('stops on unsubscribe', () => {
    let count = 0;
    const off = eventBus.onSource('selection:clear', 'database', () => {
      count++;
    });

    eventBus.emit('selection:clear', { source: 'database' });
    off();
    eventBus.emit('selection:clear', { source: 'database' });

    expect(count).toBe(1);
  });
});
