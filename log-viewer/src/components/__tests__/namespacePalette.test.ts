/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { NAMESPACE_COLORS, logNamespacePalette, namespacePalette } from '../namespacePalette.js';
import { log } from './fixtures/logEvents.js';

const names = (count: number, prefix = 'ns') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

/** The hues of {@link NAMESPACE_COLORS}, as the palette holds them. */
const WONG_HUES = [244, 48, 165, 346, 77, 236, 335, 180];

/** The lightness and hue of a generated `oklch(L C H)` colour, or null for a literal. */
function generated(color: string): { lightness: string; hue: number } | null {
  const parts = /^oklch\((\d[\d.]*) [\d.]+ (\d+)\)$/.exec(color);
  return parts ? { lightness: parts[1]!, hue: Number(parts[2]) } : null;
}

/** Degrees between two hues the short way round. */
function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

describe('namespacePalette', () => {
  it('holds the first colour for default, whoever asks first', () => {
    // `npsp` hashes to slot 0, so without the hold it would take default's colour.
    expect(namespacePalette(['npsp', 'default'])('default')).toBe(NAMESPACE_COLORS[0]);
    expect(namespacePalette(['default', ...names(20)])('default')).toBe(NAMESPACE_COLORS[0]);
  });

  it('gives a namespace the same colour whatever order the log names them in', () => {
    const forwards = namespacePalette(['default', 'c2g', 'ffirule', 'pse']);
    const backwards = namespacePalette(['default', 'pse', 'ffirule', 'c2g']);

    for (const namespace of ['c2g', 'ffirule', 'pse']) {
      expect(backwards(namespace)).toBe(forwards(namespace));
    }
  });

  it('takes the eight colour-blind-safe colours first', () => {
    const namespaces = ['default', ...names(7)];

    expect(new Set(namespaces.map(namespacePalette(namespaces)))).toEqual(
      new Set(NAMESPACE_COLORS),
    );
  });

  it('gives every namespace its own colour well past the eight', () => {
    const namespaces = names(30);
    const color = namespacePalette(namespaces);

    expect(new Set(namespaces.map(color)).size).toBe(namespaces.length);
  });

  it('keeps a generated hue clear of the literals and of the band it joins', () => {
    const namespaces = ['default', ...names(15)];
    const assigned = namespaces.map(namespacePalette(namespaces)).map(generated);
    const band = assigned.filter((colour) => colour?.lightness === '0.65');

    // Eight literals hold the band, so the eight past them are generated into it.
    expect(band).toHaveLength(NAMESPACE_COLORS.length);
    const hues = band.map((colour) => colour!.hue);
    for (const [index, hue] of hues.entries()) {
      for (const other of [...WONG_HUES, ...hues.slice(index + 1)]) {
        expect(hueGap(hue, other)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('moves to another lightness once a band is full, so hue alone need not carry it', () => {
    const namespaces = ['default', ...names(23)];
    const lightnesses = namespaces
      .map(namespacePalette(namespaces))
      .map((color) => generated(color)?.lightness)
      .filter((lightness): lightness is string => lightness !== undefined);

    expect(new Set(lightnesses).size).toBeGreaterThan(1);
  });

  it('answers the same colour every time it is asked', () => {
    const color = namespacePalette(names(12));

    expect(color('ns11')).toBe(color('ns11'));
  });
});

describe('logNamespacePalette', () => {
  it('memoises per log, so every bar shares one assignment', () => {
    const apexLog = log([], ['pkg']);

    expect(logNamespacePalette(apexLog)).toBe(logNamespacePalette(apexLog));
  });

  it('lets the log name its own namespaces before an unnamed one asks', () => {
    const apexLog = log([], names(8));
    const color = logNamespacePalette(apexLog);
    const own = new Set(names(8).map(color));

    // Eight named namespaces and `default` hold all eight literals, so a late
    // asker is generated a colour rather than taking one already in use.
    expect(generated(color('late'))).not.toBeNull();
    expect(own.has(color('late'))).toBe(false);
  });
});
