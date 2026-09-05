/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { InspectorEmphasis } from '../inspectorEmphasis.js';

describe('InspectorEmphasis', () => {
  let emphasis: InspectorEmphasis;

  beforeEach(() => {
    emphasis = new InspectorEmphasis();
  });

  it('starts with nothing emphasised', () => {
    expect(emphasis.current()).toEqual([]);
  });

  it('lights the frames under the pointer while it is over a row', () => {
    emphasis.pick([3]);
    expect(emphasis.report([7, 9], false)).toEqual([7, 9]);
  });

  it('keeps the picked frame lit once the pointer leaves', () => {
    emphasis.pick([3]);
    emphasis.report([7], false);
    expect(emphasis.report([], false)).toEqual([3]);
  });

  it('holds a picked row, pointer or no pointer', () => {
    expect(emphasis.report([7, 9], true)).toEqual([7, 9]);
    expect(emphasis.report([], false)).toEqual([7, 9]);
  });

  it('replaces the pick with the next one', () => {
    emphasis.report([7], true);
    expect(emphasis.report([4], true)).toEqual([4]);
  });

  it('drops everything when the pick is cleared', () => {
    emphasis.report([7], false);
    expect(emphasis.report([], true)).toEqual([]);
  });

  it('leaves nothing emphasised once the view deselects', () => {
    emphasis.report([7], true);
    expect(emphasis.pick([])).toEqual([]);
  });
});
