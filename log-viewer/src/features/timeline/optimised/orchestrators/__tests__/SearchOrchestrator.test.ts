/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { framesOf } from '#test-helpers/timeline.js';
import { EventMatcher, textPredicate } from '../../search/EventMatcher.js';
import { TimelineViewport } from '../../TimelineViewport.js';
import { SearchOrchestrator } from '../SearchOrchestrator.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1200)|METHOD_ENTRY|[3]|01p|ns.Inner.First()\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Inner.First()\n' +
  '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';

// The renderers need WebGL, which jsdom lacks, so this sets only what a step reads.
function searched() {
  const callbacks = {
    onSearchNavigate: jest.fn(),
    onCenterOnMatch: jest.fn(),
    onClearSelection: jest.fn(),
    requestRender: jest.fn(),
  };
  const orchestrator = new SearchOrchestrator(callbacks);
  const matcher = new EventMatcher(framesOf(LOG).frames);
  matcher.search(textPredicate('ns.'));
  const internals = orchestrator as unknown as Record<string, unknown>;
  internals['eventMatcher'] = matcher;
  internals['viewport'] = new TimelineViewport(400, 300, 1e9, 5);
  return { orchestrator, callbacks };
}

describe('SearchOrchestrator.setCurrentMatch', () => {
  it('centres on the match, opens its panel and drops the selection', () => {
    const { orchestrator, callbacks } = searched();
    orchestrator.setCurrentMatch(1);

    const match = orchestrator.getCursor()?.getCurrent();
    expect(match?.event.text).toBe('ns.Inner.First()');
    expect(callbacks.onClearSelection).toHaveBeenCalledTimes(1);
    expect(callbacks.onCenterOnMatch).toHaveBeenCalledWith(
      match?.event.timestamp,
      match?.event.duration,
      match?.depth,
    );
    expect(callbacks.onSearchNavigate).toHaveBeenCalledTimes(1);
  });

  it('makes none current for -1, and leaves the view alone', () => {
    const { orchestrator, callbacks } = searched();
    orchestrator.setCurrentMatch(1);
    jest.clearAllMocks();
    orchestrator.setCurrentMatch(-1);

    expect(orchestrator.getCursor()?.currentIndex).toBe(-1);
    expect(callbacks.onCenterOnMatch).not.toHaveBeenCalled();
    expect(callbacks.requestRender).toHaveBeenCalledTimes(1);
  });
});
