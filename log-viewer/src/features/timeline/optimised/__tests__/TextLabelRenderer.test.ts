/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { TEXT_LABEL_CONSTANTS } from '../../types/flamechart.types.js';

/**
 * Tests for TextLabelRenderer truncation logic.
 *
 * Note: These tests focus on the truncation algorithm which is the core
 * text processing logic. Full integration tests would require mocking
 * PixiJS BitmapText and Container which is complex.
 */

// Extract the truncation logic for isolated testing (mirrors TextLabelRenderer.truncateText)
function truncateText(text: string, availableWidth: number): string | null {
  const maxChars = Math.floor(availableWidth / TEXT_LABEL_CONSTANTS.CHAR_WIDTH);

  // Too narrow for any text
  if (maxChars < TEXT_LABEL_CONSTANTS.MIN_CHARS_WITH_ELLIPSIS) {
    return null;
  }

  // Full text fits
  if (text.length <= maxChars) {
    return text;
  }

  // For very short space (1-3 chars), just show start + ellipsis
  if (maxChars <= 3) {
    return text.slice(0, maxChars - 1) + TEXT_LABEL_CONSTANTS.ELLIPSIS;
  }

  // Middle truncation: keep start and end, ellipsis in middle
  const charsAvailable = maxChars - 1; // -1 for ellipsis
  const startChars = Math.ceil(charsAvailable / 2);
  const endChars = Math.floor(charsAvailable / 2);

  return (
    text.slice(0, startChars) + TEXT_LABEL_CONSTANTS.ELLIPSIS + text.slice(text.length - endChars)
  );
}

describe('TextLabelRenderer', () => {
  describe('truncateText', () => {
    // Constants for reference:
    // CHAR_WIDTH = 6
    // MIN_CHARS_WITH_ELLIPSIS = 1
    // MIN_VISIBLE_WIDTH = 12

    it('should return null for width that allows fewer than MIN_CHARS_WITH_ELLIPSIS', () => {
      // 5px / 6px per char = 0.8 = 0 chars max
      // 0 < MIN_CHARS_WITH_ELLIPSIS (1), so null
      expect(truncateText('Test', 5)).toBeNull();
    });

    it('should return just ellipsis when only room for 1 char', () => {
      // 6px / 6px per char = 1 char max
      // "Test" needs truncation, but with only 1 char we get "…" (0 chars + ellipsis)
      expect(truncateText('Test', 6)).toBe('…');
    });

    it('should return 1 char + ellipsis when room for 2 chars', () => {
      // 12px / 6px per char = 2 chars max
      // "Test" needs truncation to "T…"
      expect(truncateText('Test', 12)).toBe('T…');
    });

    it('should return 2 chars + ellipsis when room for 3 chars', () => {
      // 18px / 6px per char = 3 chars max
      // "Testing" needs truncation to "Te…"
      expect(truncateText('Testing', 18)).toBe('Te…');
    });

    it('should return full text when it fits within available width', () => {
      // 100px / 6px per char = 16.6 = 16 chars max
      // "Test" is 4 chars, which fits
      expect(truncateText('Test', 100)).toBe('Test');
    });

    it('should return full text when it exactly fits', () => {
      // 36px / 6px per char = 6 chars max
      // "Method" is 6 chars, which exactly fits
      expect(truncateText('Method', 36)).toBe('Method');
    });

    it('should use middle truncation when text exceeds available width and room for 4+ chars', () => {
      // 48px / 6px per char = 8 chars max
      // "MyClass.myMethod" is 16 chars
      // With 8 chars max and > 3: middle truncation
      // 7 chars available (minus 1 for ellipsis)
      // startChars = ceil(7/2) = 4, endChars = floor(7/2) = 3
      // Result: "MyCl…hod"
      expect(truncateText('MyClass.myMethod', 48)).toBe('MyCl…hod');
    });

    it('should truncate long method names with middle ellipsis', () => {
      // 108px / 6px per char = 18 chars max
      // "VeryLongMethodName" is 18 chars, which exactly fits
      expect(truncateText('VeryLongMethodName', 108)).toBe('VeryLongMethodName');

      // With a slightly shorter width:
      // 96px / 6px = 16 chars max
      // 15 chars available (minus 1 for ellipsis)
      // startChars = 8, endChars = 7
      // "VeryLong…hodName"
      expect(truncateText('VeryLongMethodName', 96)).toBe('VeryLong…hodName');
    });

    it('should handle empty string input', () => {
      // Empty string fits in any width that supports text
      expect(truncateText('', 100)).toBe('');
    });

    it('should return null for zero width', () => {
      expect(truncateText('Test', 0)).toBeNull();
    });

    it('should return null for negative width', () => {
      expect(truncateText('Test', -10)).toBeNull();
    });

    it('should handle minimum viable width (1 char)', () => {
      // Need at least 1 char: 1 * 6px = 6px minimum
      // 6px / 6px = 1 char max
      expect(truncateText('A', 6)).toBe('A');
      expect(truncateText('AB', 6)).toBe('…');
    });
  });
});
