import { tryCatch, tryCatchAsync } from '../src/trycatch.js';

describe('tryCatch', () => {
  it('returns result and null error for successful sync function', () => {
    const [result, error] = tryCatch(() => 42);
    expect(result).toBe(42);
    expect(error).toBeNull();
  });

  it('returns null result and error for throwing sync function', () => {
    const testError = new Error('fail');
    const [result, error] = tryCatch(() => {
      throw testError;
    });
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });
});

describe('tryCatchAsync', () => {
  it('returns result and null error for successful async function', async () => {
    const [result, error] = await tryCatchAsync(async () => 'hello');
    expect(result).toBe('hello');
    expect(error).toBeNull();
  });

  it('returns null result and error for rejected async function', async () => {
    const testError = new Error('async fail');
    const [result, error] = await tryCatchAsync(async () => {
      throw testError;
    });
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });

  it('handles async function that returns a resolved promise', async () => {
    const [result, error] = await tryCatchAsync(() => Promise.resolve(123));
    expect(result).toBe(123);
    expect(error).toBeNull();
  });

  it('handles async function that returns a rejected promise', async () => {
    const testError = new Error('promise rejected');
    const [result, error] = await tryCatchAsync(() => Promise.reject(testError));
    expect(result).toBeNull();
    expect(error).toBe(testError);
  });
});
