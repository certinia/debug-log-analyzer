/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { framesOf } from '#test-helpers/timeline.js';
import { buildTimelineFrames } from '../../../utils/timeline-frames.js';
import { EventMatcher, textPredicate } from '../EventMatcher.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1200)|METHOD_ENTRY|[3]|01p|ns.Inner.First()\n' +
  '09:18:22.6 (1300)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (1400)|SOQL_EXECUTE_END|[4]|Rows:1\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Inner.First()\n' +
  '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';

describe('textPredicate', () => {
  it('matches on text or type, ignoring case by default', () => {
    const matches = textPredicate('INNER');

    expect(matches('ns.Inner.First()', 'METHOD_ENTRY')).toBe(true);
    expect(matches('ns.Outer.run()', 'METHOD_ENTRY')).toBe(false);
    expect(textPredicate('method')('anything', 'METHOD_ENTRY')).toBe(true);
  });

  it('keeps case when asked', () => {
    const matches = textPredicate('First', true);

    expect(matches('ns.Inner.First()', 'METHOD_ENTRY')).toBe(true);
    expect(matches('ns.Inner.first()', 'METHOD_ENTRY')).toBe(false);
    expect(textPredicate('method', true)('anything', 'METHOD_ENTRY')).toBe(false);
  });
});

describe('EventMatcher', () => {
  it('finds the shown frames that match, in log order', () => {
    const { frames } = framesOf(LOG);
    const cursor = new EventMatcher(frames).search(textPredicate('ns.'));

    expect(cursor.matches.map((match) => match.event.text)).toEqual([
      'ns.Outer.run()',
      'ns.Inner.First()',
    ]);
  });

  it('skips a frame with no duration', () => {
    const { frames } = framesOf(
      LOG +
        '09:18:22.6 (1900)|METHOD_ENTRY|[6]|01p|ns.Instant.run()\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[6]|ns.Instant.run()\n',
    );
    const texts = new EventMatcher(frames)
      .search(textPredicate('ns.'))
      .matches.map((match) => match.event.text);

    expect(texts).not.toContain('ns.Instant.run()');
    expect(texts).toHaveLength(2);
  });

  it('skips a frame with no rect', () => {
    const { index } = framesOf(LOG);
    const apexOnly = buildTimelineFrames(index, new Set(['Apex']), 0);

    expect(new EventMatcher(apexOnly).search(textPredicate('select')).total).toBe(0);
    expect(new EventMatcher(apexOnly).search(textPredicate('ns.')).total).toBe(2);
  });

  it('builds a match event only when it is read', () => {
    const { frames } = framesOf(LOG);
    const node = jest.spyOn(frames, 'node');
    const cursor = new EventMatcher(frames).search(textPredicate('ns.'));
    const ids = cursor.getMatchedEventIds();
    const info = cursor.getMatchedEventsInfo();

    expect(node).not.toHaveBeenCalled();

    const first = cursor.matches[0]!;
    expect(ids.has(first.event.id)).toBe(true);
    expect(info[0]).toMatchObject({
      timestamp: first.event.timestamp,
      duration: first.event.duration,
    });
    expect(first.event).toBe(first.event);
    expect(node).toHaveBeenCalledTimes(1);
  });
});
