/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * ColorUtils
 *
 * Shared utilities for parsing CSS color strings to PixiJS numeric hex format.
 * Used by renderers that need to extract colors from CSS variables.
 */

/**
 * Parse a CSS color string to a numeric hex value (0xRRGGBB).
 *
 * Supports:
 * - Hex formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 * - RGB/RGBA functions: rgb(r, g, b), rgba(r, g, b, a)
 *
 * @param cssColor - CSS color string to parse
 * @param defaultColor - Fallback color if parsing fails (default: 0x1e1e1e dark gray)
 * @returns Numeric hex color (0xRRGGBB format)
 */
export function parseColorToHex(cssColor: string, defaultColor: number = 0x1e1e1e): number {
  if (!cssColor) {
    return defaultColor;
  }

  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1);

    // #RRGGBBAA (8 chars) - extract RGB, ignore alpha
    if (hex.length === 8) {
      return parseInt(hex.slice(0, 6), 16);
    }

    // #RRGGBB (6 chars)
    if (hex.length === 6) {
      return parseInt(hex, 16);
    }

    // #RGB (3 chars) or #RGBA (4 chars) - expand first 3 chars to 6, ignore alpha
    if (hex.length === 3 || hex.length === 4) {
      const r = hex[0]!;
      const g = hex[1]!;
      const b = hex[2]!;
      return parseInt(r + r + g + g + b + b, 16);
    }
  }

  // rgb() or rgba() format
  const rgba = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (rgba) {
    const r = parseInt(rgba[1]!, 10);
    const g = parseInt(rgba[2]!, 10);
    const b = parseInt(rgba[3]!, 10);
    return (r << 16) | (g << 8) | b;
  }

  return defaultColor;
}
