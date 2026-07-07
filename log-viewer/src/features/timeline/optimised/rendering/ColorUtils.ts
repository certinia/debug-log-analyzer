/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * ColorUtils
 *
 * Shared color conversion utilities for the timeline renderer.
 * Consolidates CSS-to-PixiJS parsing, luminance calculations, greyscale
 * conversion, and GPU color format packing into a single module.
 */

/**
 * Parse a CSS color string to a numeric hex value (0xRRGGBB), stripping any alpha channel.
 *
 * Use this when the renderer handles transparency separately (e.g., via `rgbToABGR(color, alpha)`
 * for GPU vertex buffers). For opaque pre-blended colors, use `cssColorToPixi()` instead.
 *
 * Supports:
 * - Hex formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 * - RGB/RGBA functions: rgb(r, g, b), rgba(r, g, b, a)
 *
 * @param cssColor - CSS color string to parse
 * @param defaultColor - Fallback color if parsing fails (default: 0x1e1e1e dark gray)
 * @returns Numeric hex color (0xRRGGBB format), alpha is stripped
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

/**
 * Convert a color to greyscale based on perceived luminance.
 * Uses standard luminance formula: 0.299*R + 0.587*G + 0.114*B
 * Then applies a dimming factor to match Chrome DevTools appearance.
 *
 * @param color - PixiJS color (0xRRGGBB)
 * @param dimFactor - Dimming multiplier applied after greyscale conversion (default: 0.7)
 * @returns Greyscale color (0xRRGGBB)
 */
export function colorToGreyscale(color: number, dimFactor: number = 0.7): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const dimmed = Math.floor(luminance * dimFactor);

  return (dimmed << 16) | (dimmed << 8) | dimmed;
}

/**
 * Determine if a background color is "light" using W3C relative luminance.
 * Uses sRGB gamma correction for accurate perceptual brightness.
 *
 * @param bgColor - Background color in PixiJS format (0xRRGGBB)
 * @returns true if the background is light (luminance > 0.179)
 */
export function isLightBackground(bgColor: number): boolean {
  const r = ((bgColor >> 16) & 0xff) / 255;
  const g = ((bgColor >> 8) & 0xff) / 255;
  const b = (bgColor & 0xff) / 255;

  const rLin = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gLin = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bLin = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  const luminance = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;

  return luminance > 0.179;
}

/**
 * Convert 0xRRGGBB color to ABGR packed uint32 for GPU vertex buffers.
 * Little-endian systems expect ABGR byte order for correct rendering.
 *
 * @param color - Color in 0xRRGGBB format
 * @param alpha - Alpha value 0.0–1.0 (default: 1.0, fully opaque)
 * @returns Packed ABGR uint32
 */
export function rgbToABGR(color: number, alpha: number = 1.0): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const a = Math.round(alpha * 255) & 0xff;
  return (a << 24) | (b << 16) | (g << 8) | r;
}

// ============================================================================
// COLOR BLENDING UTILITIES
// ============================================================================

/**
 * Default dark theme background color for alpha blending.
 * This is the standard VS Code dark theme background.
 */
export const DEFAULT_BACKGROUND_COLOR = 0x1e1e1e;

/**
 * Blend a color with a background color based on opacity.
 * Returns an opaque color that simulates the visual appearance of
 * the original color at the given opacity over the background.
 *
 * Formula: result = foreground * alpha + background * (1 - alpha)
 *
 * @param foregroundColor - The foreground color (0xRRGGBB)
 * @param opacity - Opacity value (0 to 1)
 * @param backgroundColor - Background color to blend against (default: dark theme background)
 * @returns Opaque blended color (0xRRGGBB)
 */
export function blendWithBackground(
  foregroundColor: number,
  opacity: number,
  backgroundColor: number = DEFAULT_BACKGROUND_COLOR,
): number {
  // Extract RGB components from foreground
  const fgR = (foregroundColor >> 16) & 0xff;
  const fgG = (foregroundColor >> 8) & 0xff;
  const fgB = foregroundColor & 0xff;

  // Extract RGB components from background
  const bgR = (backgroundColor >> 16) & 0xff;
  const bgG = (backgroundColor >> 8) & 0xff;
  const bgB = backgroundColor & 0xff;

  // Blend each channel: result = fg * alpha + bg * (1 - alpha)
  const invAlpha = 1 - opacity;
  const resultR = Math.round(fgR * opacity + bgR * invAlpha);
  const resultG = Math.round(fgG * opacity + bgG * invAlpha);
  const resultB = Math.round(fgB * opacity + bgB * invAlpha);

  // Combine back to a single color value
  return (resultR << 16) | (resultG << 8) | resultB;
}

/**
 * Parse CSS color string to PixiJS numeric color (opaque), pre-blending alpha with the background.
 *
 * Use this for colors that will be rendered as opaque rectangles (event bars, bucket fills).
 * If the color has alpha < 1, it is blended with the dark background to produce an opaque result,
 * avoiding per-vertex alpha and enabling single-draw-call batch rendering.
 *
 * For colors where the renderer handles alpha separately (e.g., editor UI overlays),
 * use `parseColorToHex()` instead.
 *
 * Supported formats:
 * - #RGB (3 hex digits)
 * - #RGBA (4 hex digits)
 * - #RRGGBB (6 hex digits)
 * - #RRGGBBAA (8 hex digits)
 * - rgb(r, g, b)
 * - rgba(r, g, b, a)
 *
 * @param cssColor - CSS color string
 * @returns Opaque PixiJS numeric color (0xRRGGBB)
 */
export function cssColorToPixi(cssColor: string): number {
  let color = 0x000000;
  let alpha = 1;

  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1);
    if (hex.length === 8) {
      const rgb = hex.slice(0, 6);
      alpha = parseInt(hex.slice(6, 8), 16) / 255;
      color = parseInt(rgb, 16);
    } else if (hex.length === 6) {
      color = parseInt(hex, 16);
    } else if (hex.length === 4) {
      const r = hex[0]!;
      const g = hex[1]!;
      const b = hex[2]!;
      const a = hex[3]!;
      color = parseInt(r + r + g + g + b + b, 16);
      alpha = parseInt(a + a, 16) / 255;
    } else if (hex.length === 3) {
      const r = hex[0]!;
      const g = hex[1]!;
      const b = hex[2]!;
      color = parseInt(r + r + g + g + b + b, 16);
    }
  } else {
    const rgbMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*(?:\.\d+)?))?\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1] ?? '0', 10);
      const g = parseInt(rgbMatch[2] ?? '0', 10);
      const b = parseInt(rgbMatch[3] ?? '0', 10);
      alpha = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1;
      color = (r << 16) | (g << 8) | b;
    }
  }

  // Pre-blend with background if color has alpha < 1
  if (alpha < 1) {
    return blendWithBackground(color, alpha);
  }

  return color;
}
