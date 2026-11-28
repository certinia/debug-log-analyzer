/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_TYPES } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { LEVEL_ADDS } from '../levelContents.js';

describe('LEVEL_ADDS', () => {
  it('describes exactly the levels at which the parser places events', () => {
    const withEvents = new Set(EVENT_TYPES.map((t) => `${t.debugCategory} ${t.debugLevel}`));
    const described = new Set(
      Object.entries(LEVEL_ADDS).flatMap(([category, labels]) =>
        Object.entries(labels)
          .filter(([, label]) => label.trim())
          .map(([level]) => `${category} ${level}`),
      ),
    );

    expect(described).toEqual(withEvents);
  });
});
