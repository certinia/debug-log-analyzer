/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

// The renderer touches pixi only inside its methods, so the 2MB bundle need not load.
jest.mock('pixi.js', () => ({}));

import { TextLabelRenderer } from '../TextLabelRenderer.js';

// Reads no instance state, so it runs without the PixiJS container a renderer needs.
const { truncateText } = TextLabelRenderer.prototype as unknown as {
  truncateText: (text: string, availableWidth: number) => string | null;
};

describe('TextLabelRenderer.truncateText', () => {
  // Each character is 6px wide.
  it.each<[string, number, string | null]>([
    ['Test', 5, null],
    ['Test', 0, null],
    ['Test', -10, null],
    ['Test', 6, '…'],
    ['AB', 6, '…'],
    ['A', 6, 'A'],
    ['Test', 12, 'T…'],
    ['Testing', 18, 'Te…'],
    ['Test', 100, 'Test'],
    ['Method', 36, 'Method'],
    ['', 100, ''],
    // From 4 characters the middle goes, keeping one more character at the start.
    ['MyClass.myMethod', 48, 'MyCl…hod'],
    ['VeryLongMethodName', 108, 'VeryLongMethodName'],
    ['VeryLongMethodName', 96, 'VeryLong…hodName'],
  ])('fits %j into %ipx as %j', (text, width, expected) => {
    expect(truncateText(text, width)).toBe(expected);
  });
});
