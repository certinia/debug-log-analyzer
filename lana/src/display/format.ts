/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** `1 log`, `2 logs`; pass `nouns` when the plural is not the noun plus `s`. */
export function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

/** Bytes as megabytes to one decimal place, e.g. `3.0 MB`. */
export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
