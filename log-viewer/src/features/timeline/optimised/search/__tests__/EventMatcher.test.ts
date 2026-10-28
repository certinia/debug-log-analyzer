/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { framesOf } from '#test-helpers/timeline.js';
import type { EventNode } from '../../../types/flamechart.types.js';
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
  it('matches on text or type, ignoring case by default', async () => {
    const matches = textPredicate('INNER');

    expect(matches('ns.Inner.First()', 'METHOD_ENTRY')).toBe(true);
    expect(matches('ns.Outer.run()', 'METHOD_ENTRY')).toBe(false);
    expect(textPredicate('method')('anything', 'METHOD_ENTRY')).toBe(true);
  });

  it('keeps case when asked', async () => {
    const matches = textPredicate('First', true);

    expect(matches('ns.Inner.First()', 'METHOD_ENTRY')).toBe(true);
    expect(matches('ns.Inner.first()', 'METHOD_ENTRY')).toBe(false);
    expect(textPredicate('method', true)('anything', 'METHOD_ENTRY')).toBe(false);
  });
});

describe('EventMatcher', () => {
  it('finds the shown frames that match, in log order', async () => {
    const { frames } = await framesOf(LOG);
    const cursor = await new EventMatcher(frames).search(textPredicate('ns.'));

    expect(cursor?.matches.map((match) => match.event.text)).toEqual([
      'ns.Outer.run()',
      'ns.Inner.First()',
    ]);
  });

  it('makes no match current until a seek, and none again for -1', async () => {
    const { frames } = await framesOf(LOG);
    const cursor = await new EventMatcher(frames).search(textPredicate('ns.'));
    expect(cursor?.currentIndex).toBe(-1);
    expect(cursor?.getCurrent()).toBeNull();

    expect(cursor?.seek(1)?.event.text).toBe('ns.Inner.First()');
    expect(cursor?.seek(-1)).toBeNull();
    expect(cursor?.currentIndex).toBe(-1);
  });

  it('skips a frame with no duration', async () => {
    const { frames } = await framesOf(
      LOG +
        '09:18:22.6 (1900)|METHOD_ENTRY|[6]|01p|ns.Instant.run()\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[6]|ns.Instant.run()\n',
    );
    const texts = (await new EventMatcher(frames).search(textPredicate('ns.')))?.matches.map(
      (match) => match.event.text,
    );

    expect(texts).not.toContain('ns.Instant.run()');
    expect(texts).toHaveLength(2);
  });

  it('skips a frame with no rect', async () => {
    const { index } = await framesOf(LOG);
    const apexOnly = buildTimelineFrames(index, new Set(['Apex']), 0);

    expect((await new EventMatcher(apexOnly).search(textPredicate('select')))?.total).toBe(0);
    expect((await new EventMatcher(apexOnly).search(textPredicate('ns.')))?.total).toBe(2);
  });

  describe('a search that runs past one slice', () => {
    // Enough frames to reach a deadline check.
    const many = Array.from(
      { length: 300 },
      (_, i) =>
        `09:18:22.6 (${2000 + i * 2})|METHOD_ENTRY|[1]|01p|ns.M${i}()\n` +
        `09:18:22.6 (${2001 + i * 2})|METHOD_EXIT|[1]|ns.M${i}()\n`,
    ).join('');

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      ['a newer search', (matcher: EventMatcher<EventNode>) => void matcher.search(() => false)],
      ['a clear', (matcher: EventMatcher<EventNode>) => matcher.clear()],
    ])('is stopped by %s while it scans, and gives null', async (_name, stop) => {
      const matcher = new EventMatcher((await framesOf(LOG + many)).frames);
      // A clock that runs out at the first deadline check, so the scan yields and sees the stop.
      jest.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(100);
      const matches = textPredicate('ns.');
      let checked = 0;
      const first = matcher.search((text, type) => {
        if (++checked === 1) {
          stop(matcher);
        }
        return matches(text, type);
      });

      expect(await first).toBeNull();
      expect(checked).toBeLessThan(300);
    });

    it('finds every match once it finishes', async () => {
      const matcher = new EventMatcher((await framesOf(LOG + many)).frames);
      // A clock that runs out at the first deadline check, so the scan yields once.
      jest.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(100);

      expect((await matcher.search(textPredicate('ns.')))?.total).toBe(302);
      expect(matcher.getCursor()?.total).toBe(302);
    });
  });

  it('builds a match event only when it is read', async () => {
    const { frames } = await framesOf(LOG);
    const node = jest.spyOn(frames, 'node');
    // Nothing stops this search, so it gives a cursor.
    const cursor = (await new EventMatcher(frames).search(textPredicate('ns.')))!;
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
