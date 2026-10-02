/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';
import { tryCatchAsync } from '../tryCatch.js';

describe('tryCatchAsync', () => {
  it('returns the resolved value and no error', async () => {
    await expect(tryCatchAsync(() => Promise.resolve(1))).resolves.toEqual([1, null]);
  });

  it('returns the rejection and no value', async () => {
    const boom = new Error('boom');
    await expect(tryCatchAsync(() => Promise.reject(boom))).resolves.toEqual([null, boom]);
  });

  it('catches a synchronous throw while the promise is being created', async () => {
    const boom = new Error('boom');
    await expect(
      tryCatchAsync(() => {
        throw boom;
      }),
    ).resolves.toEqual([null, boom]);
  });

  it('wraps a non-Error throw, keeping the original as the cause', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of the test
    const [value, error] = await tryCatchAsync(() => Promise.reject('a string'));

    expect(value).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('a string');
    expect(error?.cause).toBe('a string');
  });
});
