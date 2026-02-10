/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { parseColorToHex } from '../rendering/ColorUtils.js';

/**
 * Tests for ColorUtils - CSS color string to hex conversion.
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
});
