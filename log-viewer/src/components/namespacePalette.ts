/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';

/**
 * Wong's colour-blind-safe eight. A data palette, so these stay literal and do
 * not follow the host theme, as the timeline categories do.
 */
export const NAMESPACE_COLORS = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#aa4499',
  '#44aa99',
] as const;

/** The hues of {@link NAMESPACE_COLORS}, converted once, so a generated hue can
 *  be kept away from the colours already in play. */
const WONG_HUES = [244, 48, 165, 346, 77, 236, 335, 180] as const;

/**
 * Generated colours run in bands: a band spreads its hues round the wheel, and the
 * next band does the same at another lightness. Hue alone cannot hold twenty
 * namespaces apart, so a crowded log separates by lightness as well. Each chroma is
 * inside sRGB for every hue at that lightness — the tightest hue holds 0.11 at
 * lightness 0.65, 0.089 at 0.82 and 0.085 at 0.50 — so no hue is clipped and none
 * reads duller than its neighbours. The first band matches Wong's own lightness and
 * sits at the bottom of its chroma range, so the two sets look like one.
 */
const GENERATED_BANDS = [
  { lightness: 0.65, chroma: 0.1 },
  { lightness: 0.82, chroma: 0.08 },
  { lightness: 0.5, chroma: 0.08 },
] as const;

/** FNV-1a, 32-bit: a namespace's hue comes from its name, so a package keeps its
 *  colour between logs. */
function hueOf(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/** Degrees between two hues the short way round. */
function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

/**
 * The hue furthest from every hue in use, searched from the name's own hue so the
 * choice stays the name's. Spreading this way needs no clearance constant: as a band
 * fills the gaps close evenly instead of one namespace suddenly landing on top of
 * another.
 */
function spreadHue(name: string, used: readonly number[]): number {
  const from = hueOf(name);
  let best = from;
  let bestGap = -1;
  for (let step = 0; step < 360; step++) {
    const hue = (from + step) % 360;
    let gap = 360;
    for (const taken of used) {
      gap = Math.min(gap, hueGap(hue, taken));
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = hue;
    }
  }
  return best;
}

/**
 * A colour per namespace, so a namespace reads the same on every bar and no two
 * namespaces in one log share a colour.
 *
 * The name picks the colour, not the log's order, so a package keeps its colour
 * between logs. `default` is in every log, so the first colour is held for it
 * whenever it asks. Two names can want one of the eight, and then the second takes
 * the next free one: with a fixed set and no repeats, stability is the common case
 * rather than a guarantee. Past the eight, colours are generated in the bands of
 * {@link GENERATED_BANDS}.
 */
export function namespacePalette(namespaces: Iterable<string>): (namespace: string) => string {
  const colors = new Map<string, string>();
  // Slot 0 is held for `default`, so a namespace hashing to it cannot take it.
  const takenSlots = new Set<number>([0]);
  // A band spreads over its own hues only. The first also carries the literals,
  // which share its lightness, so a generated hue keeps clear of them too.
  const bandHues: number[][] = GENERATED_BANDS.map(() => []);
  const literalHues = bandHues[0] ?? [];
  literalHues.push(WONG_HUES[0]);
  let generated = 0;

  const assign = (namespace: string): string => {
    if (namespace === DEFAULT_NAMESPACE) {
      return NAMESPACE_COLORS[0];
    }
    const from = hueOf(namespace) % NAMESPACE_COLORS.length;
    for (let step = 0; step < NAMESPACE_COLORS.length; step++) {
      const slot = (from + step) % NAMESPACE_COLORS.length;
      if (!takenSlots.has(slot)) {
        takenSlots.add(slot);
        // Non-null: the modulo keeps the slot inside both scales.
        literalHues.push(WONG_HUES[slot]!);
        return NAMESPACE_COLORS[slot]!;
      }
    }
    const index = Math.min(
      Math.floor(generated++ / NAMESPACE_COLORS.length),
      GENERATED_BANDS.length - 1,
    );
    // Non-null: the clamp keeps the index inside both bands and their hues.
    const { lightness, chroma } = GENERATED_BANDS[index]!;
    const hues = bandHues[index]!;
    const hue = spreadHue(namespace, hues);
    hues.push(hue);
    return `oklch(${lightness} ${chroma} ${hue})`;
  };

  const color = (namespace: string): string => {
    let assigned = colors.get(namespace);
    if (!assigned) {
      assigned = assign(namespace);
      colors.set(namespace, assigned);
    }
    return assigned;
  };

  for (const namespace of namespaces) {
    color(namespace);
  }
  return color;
}

const palettes = new WeakMap<ApexLog, (namespace: string) => string>();

/**
 * The log's own colour per namespace. Every bar in every scope shares it, so a
 * namespace on the whole-log bar and on a frame's bar reads as one colour and the
 * colour carries meaning between sections. The log's own namespaces claim their
 * colours first, so a namespace the log never named cannot take one from them.
 */
export function logNamespacePalette(log: ApexLog): (namespace: string) => string {
  let palette = palettes.get(log);
  if (!palette) {
    palette = namespacePalette([DEFAULT_NAMESPACE, ...log.namespaces]);
    palettes.set(log, palette);
  }
  return palette;
}
