/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

const ADDRESS = /^0x[0-9a-f]+$/i;

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
