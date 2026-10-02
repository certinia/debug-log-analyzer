/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import { eventBus } from '../EventBus.js';

describe('eventBus.onSource', () => {
  it('hands each event to the tab that names it, and to no other', () => {
    const seen: string[] = [];
    const offTimeline = eventBus.onSource('inspector:reveal', 'timeline', (detail) => {
      seen.push(`timeline ${detail.eventIndex}`);
    });
    const offCalltree = eventBus.onSource('inspector:reveal', 'calltree', (detail) => {
      seen.push(`calltree ${detail.eventIndex}`);
    });

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 4 });
    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: 5 });

    offTimeline();
    offCalltree();
    expect(seen).toEqual(['calltree 4']);
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
