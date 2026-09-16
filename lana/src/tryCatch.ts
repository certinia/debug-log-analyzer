/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Either a value or the error that stopped it — never both, never neither. */
export type Result<T> = [T, null] | [null, Error];

/**
 * A throw site can throw anything, so the caught value is normalised to an `Error`.
 * That keeps `Result` discriminable: without it the error slot widens to `unknown`
 * and `if (error)` stops narrowing the value.
 */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown), { cause: thrown });
}

/** Runs `fn`, returning what it resolves to, or the error it threw or rejected with. */
export async function tryCatchAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return [await fn(), null];
  } catch (thrown) {
    return [null, toError(thrown)];
  }
}
