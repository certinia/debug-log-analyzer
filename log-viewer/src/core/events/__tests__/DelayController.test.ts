/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { fakeHost } from '#test-helpers/fakeHost.js';
import { DelayController } from '../DelayController.js';

describe('DelayController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const host = fakeHost();
    const delay = new DelayController(host, 150);
    host.connect();
    return { host, delay };
  }

  it('drops a waiting callback on a cancel, or when the host leaves', () => {
    const { host, delay } = setup();
    const run = jest.fn();
    delay.schedule(run);
    delay.cancel();
    delay.schedule(run);
    host.disconnect();
    jest.advanceTimersByTime(150);

    expect(run).not.toHaveBeenCalled();
  });
});
