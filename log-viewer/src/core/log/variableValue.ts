/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { bareAddress } from './variableLine.js';

/**
 * Reads the shape of a logged variable value, without ever trusting it as JSON.
 *
 * The log writes values that `JSON.parse` cannot survive: a Map serialises with
 * duplicate keys, so parsing silently loses entries; an Apex `toString()` lands
 * inside a JSON string; a truncated value keeps its marker; and an
 * unserialisable value collapses to a bare address. So this scans, and every
 * piece of text it hands back is verbatim.
 *
 * The log records one level, so this reads one level. Nesting a scan deeper
 * would only ever find the `{}` the log put there.
 */

/** Text over this length earns an expander: it cannot be read in a row. */
export const EXPAND_MIN_CHARS = 80;

/** Never lay out more than this. A logged value can be very long. */
export const RAW_CLAMP_CHARS = 2_000;

/** Past this the structure is not scanned: the raw text is the honest answer. */
const MAX_SCAN_CHARS = 64_000;

/** Entries scanned in one container. Beyond it the value reads as truncated. */
const MAX_ENTRIES = 500;

/** One entry of a container, exactly as the log wrote it. */
export interface ValueEntry {
  /** The key, or null for a list entry or an entry with no readable key. */
  key: string | null;
  text: string;
  /** The address this entry's text names, quoted or bare, where it names one.
   *  Read here because this is where entry quoting is known. */
  address: string | null;
}

export type VariableValue =
  /** The log wrote no value at all. */
  | { kind: 'empty' }
  /** A bare heap address: the value was not serialisable, not an empty object. */
  | { kind: 'address'; text: string }
  /** A number, a boolean, null, or anything this cannot name. Verbatim. */
  | { kind: 'literal'; text: string }
  | { kind: 'string'; text: string; inner: string; toStringLike: boolean; truncated: boolean }
  | {
      kind: 'container';
      brackets: '{}' | '[]';
      entries: ValueEntry[];
      truncated: boolean;
      /** The log wrote this as a string, and its text was JSON. */
      fromString: boolean;
    };

/** A collection the log cut short, as `…, ...}`. */
const CONTAINER_CUT = /,\s*\.\.\.$/;

/** A string the log cut short, as `first20chars (10 more) ...`. */
const STRING_CUT = /\(\d+ more\)\s*\.\.\.\s*$/;

/** Reads `raw` into the shape it has. Never throws, whatever the log wrote. */
export function parseVariableValue(raw: string): VariableValue {
  const text = raw.trim();
  if (!text) {
    return { kind: 'empty' };
  }
  const address = bareAddress(text);
  if (address) {
    return { kind: 'address', text: address };
  }
  if (text.startsWith('"')) {
    const inner = text.endsWith('"') && text.length > 1 ? text.slice(1, -1) : text.slice(1);
    // An Apex toString() inside the quotes: `"{k=v, k=v}"`.
    const toStringLike = inner.startsWith('{') && inner.endsWith('}') && inner.includes('=');
    return (
      (toStringLike ? null : jsonInString(inner)) ?? {
        kind: 'string',
        text,
        inner,
        toStringLike,
        truncated: STRING_CUT.test(inner),
      }
    );
  }
  const brackets = bracketsOf(text);
  if (brackets && text.length <= MAX_SCAN_CHARS) {
    return scanContainer(text, brackets, false);
  }
  return { kind: 'literal', text };
}

/**
 * A string whose text is JSON, read as the object it holds, or null where it is
 * not JSON.
 *
 * Strictly gated on a quoted key, or on being a list. An Apex `toString()` has
 * neither, and reading structure out of one would claim the log recorded
 * something it did not. A string whose text is JSON is rare, so this is for a
 * String field carrying a `JSON.serialize` result.
 */
function jsonInString(inner: string): VariableValue | null {
  // A serialised string arrives escaped, and unescaping is recovery, not
  // reformatting: the text is the log's own, with the log's own escaping undone.
  const text = inner.includes('\\"') ? inner.replaceAll('\\"', '"') : inner;
  const brackets = bracketsOf(text);
  if (!brackets || text.length > MAX_SCAN_CHARS) {
    return null;
  }
  const scanned = scanContainer(text, brackets, true);
  if (!scanned.entries.length) {
    return null;
  }
  const isJson = brackets === '[]' || scanned.entries.some((entry) => entry.key !== null);
  return isJson ? scanned : null;
}

/** True where the value cannot be read in a row and so earns an expander. */
export function isExpandable(value: VariableValue): boolean {
  switch (value.kind) {
    case 'container':
      // A chevron that opens on nothing would teach a depth the log lacks.
      return value.entries.length > 0;
    case 'string':
      return value.inner.length > EXPAND_MIN_CHARS;
    case 'literal':
      return value.text.length > EXPAND_MIN_CHARS;
    default:
      return false;
  }
}

/**
 * The one line a collapsed row shows. Clamped, so a huge value costs a row and
 * not a layout.
 */
export function previewOf(value: VariableValue, maxChars = EXPAND_MIN_CHARS): string {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'address':
      return value.text;
    case 'container': {
      // `{}` reads as `{}`. Naming it "empty object" would claim the log knew.
      const [open, close] = value.brackets;
      if (!value.entries.length) {
        return `${open}${close}`;
      }
      let body = '';
      for (const entry of value.entries) {
        body += `${body ? ', ' : ''}${entry.key === null ? entry.text : `${entry.key}: ${entry.text}`}`;
        if (body.length > maxChars) {
          break;
        }
      }
      return clamp(`${open}${body}${value.truncated ? ', …' : ''}${close}`, maxChars);
    }
    default:
      return clamp(value.text, maxChars);
  }
}

/** The raw text an expanded row shows, cut to what can be laid out. */
export function clampRaw(raw: string): { text: string; clamped: boolean } {
  return raw.length > RAW_CLAMP_CHARS
    ? { text: raw.slice(0, RAW_CLAMP_CHARS), clamped: true }
    : { text: raw, clamped: false };
}

function bracketsOf(text: string): '{}' | '[]' | null {
  if (text.startsWith('{') && text.endsWith('}')) {
    return '{}';
  }
  return text.startsWith('[') && text.endsWith(']') ? '[]' : null;
}

type Container = Extract<VariableValue, { kind: 'container' }>;

function scanContainer(text: string, brackets: '{}' | '[]', fromString: boolean): Container {
  const body = text.slice(1, -1).trim();
  if (!body) {
    return { kind: 'container', brackets, entries: [], truncated: false, fromString };
  }
  const pieces = splitTopLevel(body);
  let truncated = pieces.length > MAX_ENTRIES || CONTAINER_CUT.test(body);
  const entries = pieces
    .slice(0, MAX_ENTRIES)
    .map((piece) => piece.trim())
    .filter((piece) => {
      if (piece === '...') {
        truncated = true;
        return false;
      }
      return piece.length > 0;
    })
    .map(entryOf);
  return { kind: 'container', brackets, entries, truncated, fromString };
}

/**
 * One entry, key kept apart from value where the log wrote a quoted key.
 *
 * Duplicate keys stay, in the order the log wrote them: a Map serialises with
 * repeats, and dropping them would hide entries the transaction held.
 */
function entryOf(piece: string): ValueEntry {
  if (!piece.startsWith('"')) {
    return { key: null, ...valued(piece) };
  }
  const closing = closingQuote(piece);
  if (closing < 0 || piece[closing + 1] !== ':') {
    return { key: null, ...valued(piece) };
  }
  return { key: piece.slice(1, closing), ...valued(piece.slice(closing + 2).trim()) };
}

/** An entry's text, and the address it names. The log quotes a nested address,
 *  as the `"0x6c98700c"` in `{"delegate":"0x6c98700c"}`. */
function valued(text: string): Pick<ValueEntry, 'text' | 'address'> {
  const inner = text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  return { text, address: bareAddress(inner) };
}

/**
 * A container assembled from writes of their own, for an object the log wrote as
 * `{}` and described in lines of its own.
 *
 * Read the same way a parsed container is, so an entry names the address its
 * text names. Truncation is the caller's to state: the object was never
 * serialised, so its own line cut nothing short.
 */
export function assembledContainer(
  parts: readonly { key: string | null; text: string }[],
  truncated: boolean,
): VariableValue {
  return {
    kind: 'container',
    brackets: '{}',
    entries: parts.map((part) => ({ key: part.key, ...valued(part.text) })),
    truncated,
    fromString: false,
  };
}

/** Splits on the commas that separate entries: not those inside a string, and
 *  not those inside a nested value. */
function splitTopLevel(body: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (inString) {
      if (char === '\\') {
        at++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
    } else if (char === ',' && depth === 0) {
      pieces.push(body.slice(start, at));
      start = at + 1;
    }
  }
  pieces.push(body.slice(start));
  return pieces;
}

function closingQuote(piece: string): number {
  for (let at = 1; at < piece.length; at++) {
    if (piece[at] === '\\') {
      at++;
    } else if (piece[at] === '"') {
      return at;
    }
  }
  return -1;
}

function clamp(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
