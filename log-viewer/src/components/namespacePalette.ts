/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';

/**
 * Five of Wong's colour-blind-safe eight. A data palette, so these stay literal
 * and do not follow the host theme, as the timeline categories do.
 *
 * The other three are near-duplicates of these: two blues 7.8° apart, two
 * magentas 11.7°, and a green and a mint 14.9°. Any log naming six namespaces
 * showed such a pair, so they are left out and their slots generated instead —
 * every colour here is at least 29° from the rest.
 */
export const NAMESPACE_COLORS = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00'] as const;

/** A colour as OKLab coordinates, the space colours are compared in. */
type Oklab = readonly [lightness: number, a: number, b: number];

/** A colour a generated namespace may take, with the hue it was built from. */
interface Candidate {
  readonly lab: Oklab;
  readonly hue: number;
}

/** {@link NAMESPACE_COLORS} in OKLab, converted once. */
const WONG_OKLAB: readonly Oklab[] = [
  [0.532, -0.0575, -0.1181],
  [0.621, 0.1151, 0.1257],
  [0.62, -0.1254, 0.0325],
  [0.679, 0.1144, -0.0278],
  [0.753, 0.0361, 0.1534],
];

/**
 * The lightnesses a generated colour may take. They stay close to the literals' own
 * 0.53–0.75, so no namespace reads washed out or nearly black beside them. Hue does
 * the separating; these only carry what a crowded wheel can no longer keep apart by
 * hue alone, and having several of them widens the choice at each hue.
 */
const GENERATED_LIGHTNESS = [0.55, 0.61, 0.67, 0.73, 0.79] as const;

/**
 * The chroma a generated colour takes, as a share of what sRGB holds at its hue and
 * lightness, and the most it may take. Four of the five literals sit within 0.001
 * of that ceiling, so a generated colour has to reach for it too or it reads as one
 * of them gone dull. The cap is the literals' own widest chroma: sRGB holds nearly
 * twice that around magenta, and taking it there would put one garish chip beside a
 * restrained set.
 */
const CHROMA_REACH = 0.95;
const CHROMA_CAP = 0.17;

/** How far a generated colour keeps from every hue in use while the wheel allows it.
 *  Hue is what the eye reads as identity — two colours one hue apart are the same
 *  colour lighter or darker, however far apart OKLab says they are — so this is met
 *  before {@link CLEARANCE} is weighed at all. */
const MIN_HUE_GAP = 24;

/** How far a generated colour keeps from every colour in use, once its hue is
 *  settled. A little under the literals' own closest pair, `#d55e00` and `#e69f00`
 *  at 0.156, since hue is settled first and the wheel cannot always hold both. */
const CLEARANCE = 0.138;

/** FNV-1a, 32-bit: a namespace's colour comes from its name, so a package keeps it
 *  between logs. */
function seedOf(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function oklabOf(lightness: number, chroma: number, hue: number): Oklab {
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

const hueOf = ([, a, b]: Oklab): number => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

const chromaOf = ([, a, b]: Oklab): number => Math.hypot(a, b);

function apart(a: Oklab, b: Oklab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The shorter way round the wheel between two hues, in degrees. */
function hueApart(a: number, b: number): number {
  const between = Math.abs(a - b) % 360;
  return Math.min(between, 360 - between);
}

/** Whether an OKLab colour has an sRGB value, so the browser will not clip it to a
 *  duller one. The matrices are the OKLab specification's own. */
function inSrgb([lightness, a, b]: Oklab): boolean {
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  return channels.every((channel) => channel >= -0.0005 && channel <= 1.0005);
}

/** The most chroma sRGB holds at this lightness and hue, to within 0.0005. The
 *  ceiling has no closed form, so it is bisected. */
function maxChroma(lightness: number, hue: number): number {
  let inside = 0;
  let outside = 0.4;
  for (let step = 0; step < 12; step++) {
    const middle = (inside + outside) / 2;
    if (inSrgb(oklabOf(lightness, middle, hue))) {
      inside = middle;
    } else {
      outside = middle;
    }
  }
  return inside;
}

/** Every colour a generated namespace may take: each lightness across the whole
 *  wheel, at the most chroma that lightness and hue allow. Built on the first log
 *  to hold more namespaces than there are literals, since most logs never do. */
let candidates: readonly Candidate[] | null = null;
function generatedCandidates(): readonly Candidate[] {
  candidates ??= GENERATED_LIGHTNESS.flatMap((lightness) =>
    Array.from({ length: 360 }, (_, hue) => ({
      lab: oklabOf(lightness, Math.min(CHROMA_CAP, maxChroma(lightness, hue) * CHROMA_REACH), hue),
      hue,
    })),
  );
  return candidates;
}

/**
 * How far every candidate sits from the colours already in use, kept as the colours
 * are handed out so choosing one costs a single pass rather than one per colour.
 */
class Distances {
  private readonly pool = generatedCandidates();
  private readonly hueGaps: Float64Array;
  private readonly gaps: Float64Array;

  constructor(used: readonly Oklab[]) {
    this.hueGaps = new Float64Array(this.pool.length).fill(Infinity);
    this.gaps = new Float64Array(this.pool.length).fill(Infinity);
    used.forEach((color) => this.note(color));
  }

  /** Note a colour as in use, closing the gaps around it. */
  note(color: Oklab): void {
    const hue = hueOf(color);
    for (let index = 0; index < this.pool.length; index++) {
      const candidate = this.pool[index]!; // in range: the arrays share its length
      this.hueGaps[index] = Math.min(this.hueGaps[index]!, hueApart(candidate.hue, hue));
      this.gaps[index] = Math.min(this.gaps[index]!, apart(candidate.lab, color));
    }
  }

  /**
   * The candidate a name takes. Hue is settled first, so no distance in OKLab can
   * buy a colour that reads as another one lighter: only once the wheel is too
   * crowded to hold {@link MIN_HUE_GAP} does the gap narrow, and lightness and
   * chroma carry what hue no longer can. The name then picks from every candidate
   * that qualifies, so the colour is the name's rather than the log's order —
   * qualifying candidates form arcs, and taking the first would hand every name the
   * same arc edge.
   */
  pick(seed: number): Candidate {
    const wanted = Math.min(MIN_HUE_GAP, this.widest(this.hueGaps) * 0.9);
    const byHue: number[] = [];
    for (let index = 0; index < this.pool.length; index++) {
      if (this.hueGaps[index]! >= wanted) {
        byHue.push(index);
      }
    }
    const clearance = Math.min(CLEARANCE, this.widest(this.gaps, byHue) * 0.9);
    const eligible = byHue.filter((index) => this.gaps[index]! >= clearance);
    // Non-null: nine tenths of the widest gap on offer always leaves one candidate.
    return this.pool[eligible[seed % eligible.length]!]!;
  }

  private widest(gaps: Float64Array, over?: readonly number[]): number {
    const indices = over ?? gaps.keys();
    let widest = 0;
    for (const index of indices) {
      widest = Math.max(widest, gaps[index]!);
    }
    return widest;
  }
}

/** A candidate as the CSS the bars take. */
function cssOf({ lab, hue }: Candidate): string {
  return `oklch(${lab[0]} ${chromaOf(lab).toFixed(3)} ${hue})`;
}

/**
 * A colour per namespace, so a namespace reads the same on every bar and no two
 * namespaces in one log share a colour.
 *
 * The name picks the colour, not the log's order, so a package keeps its colour
 * between logs. `default` is in every log, so the first colour is held for it
 * whenever it asks.
 *
 * No two namespaces in one log may share a colour, and that comes first, so
 * stability is the common case rather than a guarantee: two names can want one of
 * the literals and the second takes the next free one, and a generated colour has
 * to clear whatever is already in use. So the set of namespaces decides, never the
 * order they appear in: a namespace keeps its colour between two logs holding the
 * same packages, and a log holding a different set can move it.
 */
export function namespacePalette(namespaces: Iterable<string>): (namespace: string) => string {
  const colors = new Map<string, string>();
  // Slot 0 is held for `default`, so a namespace hashing to it cannot take it.
  const takenSlots = new Set<number>([0]);
  const used: Oklab[] = [WONG_OKLAB[0]!];
  let distances: Distances | null = null;

  const assign = (namespace: string): string => {
    if (namespace === DEFAULT_NAMESPACE) {
      return NAMESPACE_COLORS[0];
    }
    const seed = seedOf(namespace);
    for (let step = 0; step < NAMESPACE_COLORS.length; step++) {
      const slot = (seed + step) % NAMESPACE_COLORS.length;
      if (!takenSlots.has(slot)) {
        takenSlots.add(slot);
        // Non-null: the modulo keeps the slot inside both scales.
        const literal = WONG_OKLAB[slot]!;
        used.push(literal);
        distances?.note(literal);
        return NAMESPACE_COLORS[slot]!;
      }
    }
    distances ??= new Distances(used);
    const spread = distances.pick(seed);
    used.push(spread.lab);
    distances.note(spread.lab);
    return cssOf(spread);
  };

  const color = (namespace: string): string => {
    let assigned = colors.get(namespace);
    if (!assigned) {
      assigned = assign(namespace);
      colors.set(namespace, assigned);
    }
    return assigned;
  };

  // Sorted, so the set of namespaces decides the assignment and the order the log
  // happens to name them in cannot.
  for (const namespace of [...namespaces].sort()) {
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
