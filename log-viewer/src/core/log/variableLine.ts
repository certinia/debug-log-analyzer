/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The fields of a variable log line, read from the raw line the parser kept.
 *
 * The parser models only `lineNumber` on these events and joins the rest into a
 * lossy `text`, so everything here comes from `event.logLine`.
 */

/** A write the log recorded, from a `VARIABLE_ASSIGNMENT` line. */
export interface VariableWrite {
  /** `name` for a local, `this.name` for a field, `Class.name` for a static. */
  name: string;
  /** The value exactly as the log wrote it. Never parsed here. */
  value: string;
  /** The heap address the log reported, where it reported one. */
  address: string | null;
}

/** A declaration, from a `VARIABLE_SCOPE_BEGIN` line. */
export interface VariableScope {
  name: string;
  declaredType: string;
  isStatic: boolean;
}

const ADDRESS = /^0x[0-9a-f]+$/i;

/**
 * Just the name from a `VARIABLE_ASSIGNMENT` line, or null where the line
 * carries no name, or no value after it.
 *
 * For a walk of the whole log: it never touches the value, which can reach tens
 * of thousands of characters.
 */
export function variableNameOf(logLine: string): string | null {
  const nameStart = pipeAfter(logLine, 3);
  if (nameStart < 0) {
    return null;
  }
  const nameEnd = logLine.indexOf('|', nameStart);
  // A name and no value: nothing to show, so not a write.
  if (nameEnd < 0) {
    return null;
  }
  return logLine.slice(nameStart, nameEnd).trim() || null;
}

/** Where a line's value starts and ends, and the address that follows it.
 *  Null where the line carries no value at all. */
interface ValueSpan {
  start: number;
  end: number;
  address: string | null;
}

/**
 * The span of a `VARIABLE_ASSIGNMENT` line's value.
 *
 * Found by pipe *position*, never by `split('|')`, and the last field is read
 * for what it is rather than assumed:
 *
 * - an address (`|0x7d1781a3`), which belongs to the value, not in it;
 * - **empty** (`|a|null|`), the address field present with nothing in it. Taken
 *   as part of the value it reads as `null|`;
 * - anything else, which is the value's own text.
 */
function valueSpan(logLine: string): ValueSpan | null {
  const nameStart = pipeAfter(logLine, 3);
  if (nameStart < 0) {
    return null;
  }
  const start = logLine.indexOf('|', nameStart) + 1;
  if (start <= 0) {
    return null;
  }
  const lastPipe = logLine.lastIndexOf('|');
  if (lastPipe >= start) {
    const tail = logLine.slice(lastPipe + 1);
    if (!tail) {
      return { start, end: lastPipe, address: null };
    }
    if (ADDRESS.test(tail)) {
      return { start, end: lastPipe, address: tail };
    }
  }
  return { start, end: logLine.length, address: null };
}

/** Reads a `VARIABLE_ASSIGNMENT` line, or null where it carries no name. */
export function parseVariableWrite(logLine: string): VariableWrite | null {
  const name = variableNameOf(logLine);
  const span = name && valueSpan(logLine);
  if (!name || !span) {
    return null;
  }
  return { name, value: logLine.slice(span.start, span.end), address: span.address };
}

/**
 * Reads a `VARIABLE_SCOPE_BEGIN` line, or null where it is too short to carry a
 * declaration.
 *
 * The two flags trail the declared type: the first says whether the variable can
 * be referenced, the second whether it is static. A type holds commas
 * (`Map<String,Object>`) but never a pipe, so both are read from the right.
 */
export function parseVariableScope(logLine: string): VariableScope | null {
  const parts = logLine.split('|');
  if (parts.length < 7) {
    return null;
  }
  const isStatic = parts[parts.length - 1]?.trim() === 'true';
  const declaredType = parts[parts.length - 3]?.trim() ?? '';
  const name = parts[3]?.trim() ?? '';
  return name ? { name, declaredType, isStatic } : null;
}

/** The longest an address is. Past it, a value cannot be one. */
const ADDRESS_MAX = 32;

/** The address a value is, where the log wrote an address in place of a value:
 *  the value would not serialise, so the log named where it lived instead.
 *
 *  Length first, so a very long value is rejected without being copied. */
export function bareAddress(value: string): string | null {
  if (value.length > ADDRESS_MAX * 2) {
    return null;
  }
  const text = value.trim();
  return ADDRESS.test(text) ? text : null;
}

/**
 * {@link bareAddress} for a whole line, for a walk of the whole log: it gives up
 * on length before it slices, so a very long value costs nothing.
 */
export function bareAddressOf(logLine: string): string | null {
  const span = valueSpan(logLine);
  return span && span.end - span.start <= ADDRESS_MAX
    ? bareAddress(logLine.slice(span.start, span.end))
    : null;
}

/**
 * The address a line reported for the value it wrote, or null where it reported
 * none.
 *
 * Cheap on any line: the address trails the value, so this reads back from the
 * end rather than through it.
 */
export function reportedAddressOf(logLine: string): string | null {
  return valueSpan(logLine)?.address ?? null;
}

/** Chars of a value scanned for the addresses it names. An address the log
 *  bothered to name appears early, and a value can be very long. */
const NESTED_SCAN_MAX = 4_000;

const NESTED_ADDRESS = /0x[0-9a-f]+/gi;

/**
 * Every address a line's value names *inside* itself, as the `"0x6c98700c"` in
 * `{"m_tliFilter":"0x6c98700c"}`.
 *
 * The address the line reports for its own value is left out: every assignment
 * reports one, so taking them all would hold a quarter of a million events.
 */
export function nestedAddressesOf(logLine: string): readonly string[] {
  const span = valueSpan(logLine);
  if (!span) {
    return [];
  }
  const end = Math.min(span.end, span.start + NESTED_SCAN_MAX);
  const found = logLine.indexOf('0x', span.start);
  // Tested on the line itself: slicing first would allocate up to 4KB for every
  // assignment in the log, and most name no address at all.
  if (found < 0 || found >= end) {
    return [];
  }
  return logLine.slice(span.start, end).match(NESTED_ADDRESS) ?? [];
}

/** The class a static belongs to, or null for a name that names no class. */
export function classOf(staticName: string): string | null {
  const lastDot = staticName.lastIndexOf('.');
  return lastDot > 0 ? staticName.slice(0, lastDot) : null;
}

/** A qualified name without its owner, for a row whose group already names it. */
export function shortName(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(lastDot + 1) : name;
}

/** True for a name the log qualified with its class, which every static is. */
export function isStaticName(name: string): boolean {
  return name.includes('.') && !name.startsWith('this.');
}

/** The character after the nth pipe, or -1 where the line has fewer. */
function pipeAfter(line: string, pipes: number): number {
  let at = -1;
  for (let found = 0; found < pipes; found++) {
    at = line.indexOf('|', at + 1);
    if (at < 0) {
      return -1;
    }
  }
  return at + 1;
}
