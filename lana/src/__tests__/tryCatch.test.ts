/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { tryCatch, tryCatchAsync } from '../tryCatch.js';

describe('tryCatch', () => {
  it('returns the value and no error', () => {
    expect(tryCatch(() => 42)).toEqual([42, null]);
  });

  it('returns the thrown error and no value', () => {
    const boom = new Error('boom');
    expect(
      tryCatch(() => {
        throw boom;
      }),
    ).toEqual([null, boom]);
  });

  it('wraps a non-Error throw, keeping the original as the cause', () => {
    const [value, error] = tryCatch(() => {
      throw 'a string';
    });

    expect(value).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('a string');
    expect(error?.cause).toBe('a string');
  });

  it('narrows the value once the error is ruled out', () => {
    const [value, error] = tryCatch(() => 'ok');
    if (error) {
      throw error;
    }

    expect(value.length).toBe(2);
  });
});

describe('tryCatchAsync', () => {
  it('returns the resolved value', async () => {
    await expect(tryCatchAsync(Promise.resolve(1))).resolves.toEqual([1, null]);
  });

  it('returns the rejection', async () => {
    const boom = new Error('boom');
    await expect(tryCatchAsync(Promise.reject(boom))).resolves.toEqual([null, boom]);
  });

  it('catches a synchronous throw when given a function', async () => {
    const boom = new Error('boom');
    await expect(
      tryCatchAsync(() => {
        throw boom;
      }),
    ).resolves.toEqual([null, boom]);
  });
});
