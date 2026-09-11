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

/** Runs `fn`, returning its value or the error it threw. */
export function tryCatch<T>(fn: () => T): Result<T> {
  try {
    return [fn(), null];
  } catch (thrown) {
    return [null, toError(thrown)];
  }
}

/**
 * Awaits a promise, returning its value or the error it rejected with. Pass a
 * function to also catch a synchronous throw while the promise is being created.
 */
export async function tryCatchAsync<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
): Promise<Result<T>> {
  try {
    return [await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn), null];
  } catch (thrown) {
    return [null, toError(thrown)];
  }
}
