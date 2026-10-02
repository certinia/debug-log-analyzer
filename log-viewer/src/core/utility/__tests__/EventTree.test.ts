/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { walkEvents } from '../EventTree.js';

/** Only `children` and `text` are read here, so the rest of `LogEvent` is left off. */
function event(text: string, children: LogEvent[] = []): LogEvent {
  return { text, children } as unknown as LogEvent;
}

const textsOf = (events: Iterable<LogEvent>): string[] => [...events].map((e) => e.text);

describe('walkEvents', () => {
  it('yields nothing for no roots', () => {
    expect(textsOf(walkEvents([]))).toEqual([]);
  });

  it('yields a leaf root', () => {
    expect(textsOf(walkEvents([event('only')]))).toEqual(['only']);
  });

  it('yields every descendant, each after its parent', () => {
    const tree = event('root', [event('a', [event('a1'), event('a2')]), event('b')]);

    const walked = textsOf(walkEvents([tree]));

    expect([...walked].sort()).toEqual(['a', 'a1', 'a2', 'b', 'root']);
    expect(walked.indexOf('a')).toBeGreaterThan(walked.indexOf('root'));
    expect(walked.indexOf('a1')).toBeGreaterThan(walked.indexOf('a'));
  });

  it('walks each root, last first — the stack pops what it pushed last', () => {
    expect(textsOf(walkEvents([event('first'), event('second')]))).toEqual(['second', 'first']);
  });

  it('leaves the caller its roots', () => {
    const roots = [event('a'), event('b')];

    expect(textsOf(walkEvents(roots))).toHaveLength(2);

    expect(textsOf(roots)).toEqual(['a', 'b']);
  });

  it('walks a chain far deeper than the call stack', () => {
    const depth = 100_000;
    let deepest = event('leaf');
    for (let at = depth; at--;) {
      deepest = event(`node${at}`, [deepest]);
    }

    expect([...walkEvents([deepest])]).toHaveLength(depth + 1);
  });

  it('stops walking when the caller stops asking', () => {
    const tree = event('root', [event('a', [event('never')])]);

    const walk = walkEvents([tree]);
    walk.next();

    expect(walk.return(undefined).done).toBe(true);
  });
});
