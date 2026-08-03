/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { emptyTextFor } from '../detailEmptyText.js';

describe('emptyTextFor', () => {
  it('names what to click, per source', () => {
    expect(emptyTextFor('timeline')).toBe('Select a frame on the timeline to inspect it.');
    expect(emptyTextFor('calltree')).toBe('Select a frame in the call tree to inspect it.');
    expect(emptyTextFor('analysis')).toBe('Select a row in the analysis grid to inspect it.');
    expect(emptyTextFor('database')).toBe('Select a SOQL, DML or SOSL row to inspect it.');
  });

  it('falls back to a generic message when no tab is active', () => {
    expect(emptyTextFor(undefined)).toBe('Select a row to inspect it.');
  });
});
