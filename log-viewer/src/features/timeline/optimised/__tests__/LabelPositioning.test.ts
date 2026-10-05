/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { calculateLabelPosition, type LabelPositionParams } from '../rendering/LabelPositioning.js';

const BASE: LabelPositionParams = {
  labelWidth: 100,
  labelHeight: 50,
  screenStartX: 200,
  screenEndX: 400,
  displayWidth: 800,
  displayHeight: 600,
  padding: 8,
};

describe('calculateLabelPosition', () => {
  // A selection is "small" where its visible part is narrower than the label and its padding (116).
  it.each<[string, Partial<LabelPositionParams>, { left?: number; top?: number }]>([
    ['centres in a visible selection, and vertically in the view', {}, { left: 250, top: 275 }],
    ['centres on a small selection', { screenStartX: 350, screenEndX: 370 }, { left: 310 }],
    [
      'sticks to the left edge for a small part off the left',
      { screenStartX: -100, screenEndX: 50 },
      { left: 8 },
    ],
    ['centres in a wide part off the left', { screenStartX: -100, screenEndX: 300 }, { left: 100 }],
    [
      'sticks to the right edge for a small part off the right',
      { screenStartX: 750, screenEndX: 900 },
      { left: 692 },
    ],
    ['centres in a wide part off the right', { screenStartX: 600, screenEndX: 900 }, { left: 650 }],
    [
      'centres on the view when both edges are off',
      { screenStartX: -100, screenEndX: 900 },
      { left: 350 },
    ],
    ['clamps to the left padding', { screenStartX: 0, screenEndX: 20 }, { left: 8 }],
    ['clamps to the right of the view', { screenStartX: 780, screenEndX: 800 }, { left: 692 }],
    ['clamps a label taller than the view to the top padding', { labelHeight: 700 }, { top: 8 }],
    ['clamps a label that almost fits to the top padding', { displayHeight: 60 }, { top: 8 }],
    ['keeps a custom padding', { screenStartX: -100, screenEndX: 50, padding: 20 }, { left: 20 }],
    [
      'pads by 8 when no padding is given',
      { screenStartX: -100, screenEndX: 50, padding: undefined },
      { left: 8 },
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(calculateLabelPosition({ ...BASE, ...overrides })).toMatchObject(expected);
  });
});
