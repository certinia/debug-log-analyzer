/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import { callFrame } from '#test-helpers/events.js';
import { findRootBucket } from '../bucketRows.js';

const key = (text: string) => `METHOD_ENTRY||${text}`;

function asRows(texts: string[]): RowComponent[] {
  return texts.map((text) => ({ getData: () => ({ key: key(text) }) }) as unknown as RowComponent);
}

describe('findRootBucket', () => {
  it('heads the frame with a top-level row, so its own key finds it', () => {
    const found = findRootBucket(asRows(['other', 'target']), callFrame('target', null));

    expect(found && (found.getData() as { key: string }).key).toBe(key('target'));
  });

  it('finds nothing where no row heads the frame', () => {
    expect(findRootBucket(asRows(['other']), callFrame('gone', null))).toBeNull();
  });
});
