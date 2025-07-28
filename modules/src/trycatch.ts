/**
 * Executes a synchronous function and returns a tuple containing either the result or the error.
 *
 * @typeParam T - The type of the result returned by the function.
 * @typeParam E - The type of the error (defaults to Error).
 * @param fn - The synchronous function to execute.
 * @returns A tuple where the first element is the result (or null if an error occurred),
 * and the second element is the error (or null if no error occurred).
 *
 * @example
 * const [result, error] = tryCatch(() => JSON.parse('{"valid": true}'));
 * if (error) {
 *   // handle error
 * } else {
 *   // use result
 * }
 */
export function tryCatch<T, E = Error>(fn: () => T): [T | null, E | null] {
  try {
    const result = fn();
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}

/**
 * Executes an asynchronous function and returns a promise that resolves to a tuple containing either the result or the error.
 *
 * @typeParam T - The type of the result returned by the function.
 * @typeParam E - The type of the error.
 * @param fn - The asynchronous function to execute.
 * @returns A promise that resolves to a tuple where the first element is the result (or null if an error occurred),
 * and the second element is the error (or null if no error occurred).
 *
 * @example
 * const [result, error] = await tryCatchAsync(async () => await fetchData());
 * if (error) {
 *   // handle error
 * } else {
 *   // use result
 * }
 */
export async function tryCatchAsync<T, E>(fn: () => Promise<T>): Promise<[T | null, E | null]> {
  try {
    const result = await fn();
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}
