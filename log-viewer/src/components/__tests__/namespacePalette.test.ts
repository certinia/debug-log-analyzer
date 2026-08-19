/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { NAMESPACE_COLORS, logNamespacePalette, namespacePalette } from '../namespacePalette.js';
import { log } from './fixtures/logEvents.js';

const names = (count: number, prefix = 'ns') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

/** {@link NAMESPACE_COLORS} in OKLab, as the palette holds them. */
const WONG_OKLAB = [
  [0.532, -0.0575, -0.1181],
  [0.621, 0.1151, 0.1257],
  [0.62, -0.1254, 0.0325],
  [0.679, 0.1144, -0.0278],
  [0.753, 0.0361, 0.1534],
] as const;

/** A generated `oklch(L C H)` colour in OKLab, or null for a literal. */
function generated(color: string): [number, number, number] | null {
  const parts = /^oklch\((\d[\d.]*) ([\d.]+) (\d+)\)$/.exec(color);
  if (!parts) {
    return null;
  }
  const [lightness, chroma, hue] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

/** The hue of a colour, and the shorter way round the wheel between two of them. */
function hueOf(color: readonly number[]): number {
  return ((Math.atan2(color[2]!, color[1]!) * 180) / Math.PI + 360) % 360;
}

function hueApart(a: number, b: number): number {
  const between = Math.abs(a - b) % 360;
  return Math.min(between, 360 - between);
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Any assigned colour in OKLab, literal or generated. */
function oklabOf(color: string): readonly number[] {
  return generated(color) ?? WONG_OKLAB[NAMESPACE_COLORS.indexOf(color as never)]!;
}

describe('namespacePalette', () => {
  it('holds the first colour for default, whoever asks first', () => {
    // `sf` hashes to slot 0, so without the hold it would take default's colour.
    expect(namespacePalette(['sf', 'default'])('default')).toBe(NAMESPACE_COLORS[0]);
    expect(namespacePalette(['default', ...names(20)])('default')).toBe(NAMESPACE_COLORS[0]);
  });

  it('gives a namespace the same colour whatever order the log names them in', () => {
    // Past the literals, so both the probed and the generated colours are covered.
    const namespaces = names(14);
    const forwards = namespacePalette(['default', ...namespaces]);
    const backwards = namespacePalette(['default', ...[...namespaces].reverse()]);

    for (const namespace of namespaces) {
      expect(backwards(namespace)).toBe(forwards(namespace));
    }
  });

  it('lets the name pick the generated colour, not the position it is asked in', () => {
    // Both palettes hold the same first eight names, so only the ninth differs.
    const eight = ['default', ...names(8, 'aa')];
    const first = namespacePalette(eight)('zzz1');
    const second = namespacePalette(eight)('zzz2');

    expect(generated(first)).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('takes the colour-blind-safe literals first', () => {
    const namespaces = ['default', ...names(4)];

    expect(new Set(namespaces.map(namespacePalette(namespaces)))).toEqual(
      new Set(NAMESPACE_COLORS),
    );
  });

  it('gives every namespace its own colour well past the literals', () => {
    const namespaces = names(30);
    const color = namespacePalette(namespaces);

    expect(new Set(namespaces.map(color)).size).toBe(namespaces.length);
  });

  it('keeps a generated colour well clear of every colour in use', () => {
    // Up to twelve namespaces, which is what a bar shows; past that the wheel is
    // crowded enough that holding a hue of its own costs some of this clearance.
    const namespaces = ['default', ...names(11)];
    const assigned = namespaces.map(namespacePalette(namespaces)).map(generated);
    const spread = assigned.filter((color): color is [number, number, number] => color !== null);

    // The literals hold their colours, so the rest are generated.
    expect(spread).toHaveLength(namespaces.length - NAMESPACE_COLORS.length);
    for (const [index, color] of spread.entries()) {
      for (const other of [...WONG_OKLAB, ...spread.slice(index + 1)]) {
        expect(apart(color, other)).toBeGreaterThan(0.11);
      }
    }
  });

  it('gives a generated colour a hue of its own, not a literal lighter', () => {
    // A hue in common reads as one colour lighter or darker however far apart OKLab
    // says the two are, so hue is what the palette settles first.
    const namespaces = ['default', ...names(11)];
    const assigned = namespaces.map(namespacePalette(namespaces));
    const spread = assigned.map(generated);

    for (const [index, color] of spread.entries()) {
      if (!color) {
        continue;
      }
      const others = [...WONG_OKLAB, ...spread.slice(index + 1).filter((one) => one !== null)];
      for (const other of others) {
        expect(hueApart(hueOf(color), hueOf(other))).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('gives a generated colour the vividness of the literals, not a duller wash', () => {
    // Four of the five literals sit at the sRGB chroma ceiling for their lightness,
    // so a generated colour below their range would read as one of them gone dull.
    const namespaces = ['default', ...names(23)];
    const chromas = namespaces
      .map(namespacePalette(namespaces))
      .map((color) => generated(color))
      .filter((color): color is [number, number, number] => color !== null)
      .map(([, a, b]) => Math.hypot(a, b));

    expect(Math.min(...chromas)).toBeGreaterThanOrEqual(0.085);
  });

  it('keeps every colour apart once the floor can no longer be met', () => {
    const namespaces = ['default', ...names(39)];
    const assigned = namespaces.map(namespacePalette(namespaces)).map(oklabOf);

    // The clearance falls with the space left, so the guarantee past it is that it
    // falls evenly rather than one colour landing on another.
    for (const [index, color] of assigned.entries()) {
      for (const other of assigned.slice(index + 1)) {
        expect(apart(color, other)).toBeGreaterThan(0.05);
      }
    }
  });

  it('takes another lightness once one is crowded, so hue alone need not carry it', () => {
    const namespaces = ['default', ...names(23)];
    const lightnesses = namespaces
      .map(namespacePalette(namespaces))
      .map((color) => generated(color)?.[0])
      .filter((lightness): lightness is number => lightness !== undefined);

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
    const apexLog = log([], names(4));
    const color = logNamespacePalette(apexLog);
    const own = new Set(names(4).map(color));

    // Four named namespaces and `default` hold every literal, so a late asker is
    // generated a colour rather than taking one already in use.
    expect(generated(color('late'))).not.toBeNull();
    expect(own.has(color('late'))).toBe(false);
  });
});
