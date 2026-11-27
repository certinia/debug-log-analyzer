/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { DebugLevels } from '#core/log/levelFilter.js';
import type { LogStore } from '#core/log/LogStore.js';

jest.mock('#core/log/LogStore.js', () => ({
  ...jest.requireActual<object>('#core/log/LogStore.js'),
  filterByLevels: (log: LogStore, chosen: DebugLevels, options: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => builds.push({ log, chosen, options, resolve, reject })),
}));

import { LogLevelsController } from '../LogLevelsController.js';

interface Build {
  log: LogStore;
  chosen: DebugLevels;
  options: { signal: AbortSignal };
  resolve: (log: LogStore | null) => void;
  reject: (err: unknown) => void;
}

let builds: Build[] = [];

const captured = {
  log: { debugLevels: { apexCode: 'FINE', database: 'FINE' } },
} as unknown as LogStore;

function setUp() {
  const published: LogStore[] = [];
  const failed: unknown[] = [];
  const controllers: ReactiveController[] = [];
  const host = {
    addController: (controller: ReactiveController) => controllers.push(controller),
    requestUpdate: () => {},
  } as unknown as ReactiveControllerHost;
  const levels = new LogLevelsController(host, {
    publish: (log) => published.push(log),
    fail: (err) => failed.push(err),
  });
  return { levels, published, failed, controllers };
}

describe('LogLevelsController', () => {
  beforeEach(() => {
    builds = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ignores a pick before a log is open', async () => {
    const { levels } = setUp();

    await levels.choose('apexCode', 'DEBUG');

    expect(builds).toEqual([]);
  });

  it('chooses the captured levels for a new log', () => {
    const { levels } = setUp();

    levels.open(captured);

    expect(levels.chosen).toEqual({ apexCode: 'FINE', database: 'FINE' });
  });

  it('puts the log filtered to the chosen levels on screen', async () => {
    const { levels, published } = setUp();
    levels.open(captured);
    const filtered = {} as LogStore;

    const done = levels.choose('apexCode', 'DEBUG');
    builds[0]!.resolve(filtered);
    await done;

    expect(builds[0]!.chosen).toEqual({ apexCode: 'DEBUG', database: 'FINE' });
    expect(published).toEqual([filtered]);
  });

  it('stops a build that a second pick overtook, and keeps both picks', async () => {
    const { levels, published } = setUp();
    levels.open(captured);
    const filtered = {} as LogStore;

    const first = levels.choose('apexCode', 'DEBUG');
    const second = levels.choose('database', 'ERROR');
    builds[0]!.resolve(null);
    builds[1]!.resolve(filtered);
    await Promise.all([first, second]);

    expect(builds[0]!.options.signal.aborted).toBe(true);
    expect(builds[1]!.chosen).toEqual({ apexCode: 'DEBUG', database: 'ERROR' });
    expect(published).toEqual([filtered]);
  });

  it('goes back to the levels on screen when a build fails', async () => {
    const { levels, published, failed } = setUp();
    levels.open(captured);
    const filtered = {} as LogStore;
    const applied = levels.choose('apexCode', 'DEBUG');
    builds[0]!.resolve(filtered);
    await applied;

    const broken = levels.choose('database', 'ERROR');
    const error = new Error('boom');
    builds[1]!.reject(error);
    await broken;

    expect(levels.chosen).toEqual({ apexCode: 'DEBUG', database: 'FINE' });
    expect(failed).toEqual([error]);
    expect(published).toEqual([filtered]);
  });

  it('shows it is busy only once a build runs past a moment', async () => {
    jest.useFakeTimers();
    const { levels } = setUp();
    levels.open(captured);

    const done = levels.choose('apexCode', 'DEBUG');
    expect(levels.busy).toBe(false);
    jest.advanceTimersByTime(100);
    expect(levels.busy).toBe(true);

    builds[0]!.resolve({} as LogStore);
    await done;
    expect(levels.busy).toBe(false);
  });

  it('stops the build when the host goes', () => {
    const { levels, controllers } = setUp();
    levels.open(captured);

    void levels.choose('apexCode', 'DEBUG');
    controllers[0]!.hostDisconnected?.();

    expect(builds[0]!.options.signal.aborted).toBe(true);
  });

  it('puts the captured log back on screen on reset', async () => {
    const { levels, published } = setUp();
    levels.open(captured);
    const filtered = {} as LogStore;
    const done = levels.choose('apexCode', 'DEBUG');
    builds[0]!.resolve(filtered);
    await done;

    levels.reset();

    expect(levels.chosen).toEqual({ apexCode: 'FINE', database: 'FINE' });
    expect(published).toEqual([filtered, captured]);
  });

  it('stops a running build on reset, and keeps the log on screen', () => {
    const { levels, published } = setUp();
    levels.open(captured);

    void levels.choose('apexCode', 'DEBUG');
    levels.reset();

    expect(builds[0]!.options.signal.aborted).toBe(true);
    expect(levels.chosen).toEqual({ apexCode: 'FINE', database: 'FINE' });
    expect(published).toEqual([]);
  });
});
