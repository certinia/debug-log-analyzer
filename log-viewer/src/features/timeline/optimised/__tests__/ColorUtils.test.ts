/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import {
  DEFAULT_BACKGROUND_COLOR,
  blendWithBackground,
  cssColorToPixi,
  parseColorToHex,
} from '../rendering/ColorUtils.js';

/**
 * Tests for ColorUtils - color conversion and blending utilities.
 */

describe('ColorUtils', () => {
  describe('parseColorToHex', () => {
    describe('hex formats', () => {
      it('should parse 6-character hex (#RRGGBB)', () => {
        expect(parseColorToHex('#ff0000')).toBe(0xff0000);
        expect(parseColorToHex('#00ff00')).toBe(0x00ff00);
        expect(parseColorToHex('#0000ff')).toBe(0x0000ff);
        expect(parseColorToHex('#264f78')).toBe(0x264f78);
      });

      it('should parse 3-character hex (#RGB)', () => {
        expect(parseColorToHex('#f00')).toBe(0xff0000);
        expect(parseColorToHex('#0f0')).toBe(0x00ff00);
        expect(parseColorToHex('#00f')).toBe(0x0000ff);
        expect(parseColorToHex('#abc')).toBe(0xaabbcc);
      });

      it('should parse 8-character hex (#RRGGBBAA) ignoring alpha', () => {
        expect(parseColorToHex('#ff0000ff')).toBe(0xff0000);
        expect(parseColorToHex('#00ff0080')).toBe(0x00ff00);
        expect(parseColorToHex('#264f7899')).toBe(0x264f78);
      });

      it('should parse 4-character hex (#RGBA) ignoring alpha', () => {
        expect(parseColorToHex('#f00f')).toBe(0xff0000);
        expect(parseColorToHex('#0f08')).toBe(0x00ff00);
        expect(parseColorToHex('#abc9')).toBe(0xaabbcc);
      });
    });

    describe('rgb/rgba formats', () => {
      it('should parse rgb() format', () => {
        expect(parseColorToHex('rgb(255, 0, 0)')).toBe(0xff0000);
        expect(parseColorToHex('rgb(0, 255, 0)')).toBe(0x00ff00);
        expect(parseColorToHex('rgb(0, 0, 255)')).toBe(0x0000ff);
        expect(parseColorToHex('rgb(38, 79, 120)')).toBe(0x264f78);
      });

      it('should parse rgba() format ignoring alpha', () => {
        expect(parseColorToHex('rgba(255, 0, 0, 1)')).toBe(0xff0000);
        expect(parseColorToHex('rgba(0, 255, 0, 0.5)')).toBe(0x00ff00);
        expect(parseColorToHex('rgba(38, 79, 120, 0.5)')).toBe(0x264f78);
      });
    });

    describe('default handling', () => {
      it('should return default for empty string', () => {
        expect(parseColorToHex('')).toBe(0x1e1e1e);
        expect(parseColorToHex('', 0xff0000)).toBe(0xff0000);
      });

      it('should return default for invalid formats', () => {
        expect(parseColorToHex('invalid')).toBe(0x1e1e1e);
        expect(parseColorToHex('red')).toBe(0x1e1e1e); // CSS color names not supported
        expect(parseColorToHex('#12')).toBe(0x1e1e1e); // Invalid hex length
      });

      it('should use custom default color when provided', () => {
        expect(parseColorToHex('', 0x264f78)).toBe(0x264f78);
        expect(parseColorToHex('invalid', 0xffffff)).toBe(0xffffff);
      });
    });

    describe('edge cases', () => {
      it('should handle lowercase hex', () => {
        expect(parseColorToHex('#abcdef')).toBe(0xabcdef);
      });

      it('should handle uppercase hex', () => {
        expect(parseColorToHex('#ABCDEF')).toBe(0xabcdef);
      });

      it('should handle mixed case hex', () => {
        expect(parseColorToHex('#AbCdEf')).toBe(0xabcdef);
      });

      it('should handle rgb with no spaces', () => {
        expect(parseColorToHex('rgb(255,128,64)')).toBe(0xff8040);
      });
    });
  });

  describe('blendWithBackground', () => {
    it('should return foreground at full opacity', () => {
      expect(blendWithBackground(0xff0000, 1)).toBe(0xff0000);
      expect(blendWithBackground(0x00ff00, 1)).toBe(0x00ff00);
    });

    it('should return background at zero opacity', () => {
      expect(blendWithBackground(0xff0000, 0, 0x000000)).toBe(0x000000);
      expect(blendWithBackground(0xff0000, 0, 0xffffff)).toBe(0xffffff);
    });

    it('should blend 50% red over black', () => {
      const result = blendWithBackground(0xff0000, 0.5, 0x000000);
      // 255 * 0.5 = 128 (0x80), green and blue stay 0
      expect(result).toBe(0x800000);
    });

    it('should use default dark background when not specified', () => {
      const result = blendWithBackground(0xff0000, 0.5);
      // Red: round(255*0.5 + 30*0.5) = round(142.5) = 143 = 0x8F
      // Green: round(0*0.5 + 30*0.5) = round(15) = 15 = 0x0F
      // Blue: round(0*0.5 + 30*0.5) = round(15) = 15 = 0x0F
      expect(result).toBe(0x8f0f0f);
    });
  });

  describe('cssColorToPixi', () => {
    it('should parse opaque hex colors (same as parseColorToHex)', () => {
      expect(cssColorToPixi('#ff0000')).toBe(0xff0000);
      expect(cssColorToPixi('#2B8F81')).toBe(0x2b8f81);
      expect(cssColorToPixi('#abc')).toBe(0xaabbcc);
    });

    it('should pre-blend alpha hex colors with dark background', () => {
      // #ff000080 = red at ~50% alpha over default background (0x1e1e1e)
      const result = cssColorToPixi('#ff000080');
      // alpha = 0x80/255 ≈ 0.502
      // Red: round(255*0.502 + 30*0.498) = round(142.9) = 143 = 0x8F
      // Green: round(0*0.502 + 30*0.498) = round(14.9) = 15 = 0x0F
      // Blue: round(0*0.502 + 30*0.498) = round(14.9) = 15 = 0x0F
      expect(result).toBe(0x8f0f0f);
    });

    it('should pre-blend 4-char hex alpha', () => {
      // #f008 = red at ~0x88/255 alpha
      const result = cssColorToPixi('#f008');
      const alpha = 0x88 / 255; // ≈ 0.533
      const invAlpha = 1 - alpha;
      const r = Math.round(255 * alpha + 30 * invAlpha);
      const g = Math.round(0 * alpha + 30 * invAlpha);
      const b = Math.round(0 * alpha + 30 * invAlpha);
      expect(result).toBe((r << 16) | (g << 8) | b);
    });

    it('should parse opaque rgb()', () => {
      expect(cssColorToPixi('rgb(255, 0, 0)')).toBe(0xff0000);
      expect(cssColorToPixi('rgb(43, 143, 129)')).toBe(0x2b8f81);
    });

    it('should pre-blend rgba() with alpha', () => {
      const result = cssColorToPixi('rgba(255, 0, 0, 0.5)');
      expect(result).toBe(blendWithBackground(0xff0000, 0.5, DEFAULT_BACKGROUND_COLOR));
    });

    it('should return opaque color for rgba with alpha 1', () => {
      expect(cssColorToPixi('rgba(255, 0, 0, 1)')).toBe(0xff0000);
    });
  });
});
