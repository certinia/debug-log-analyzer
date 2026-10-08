/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { TeardownController } from '../TeardownController.js';
import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';

const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('TeardownController', () => {
  let host: FakeHost & HTMLDivElement;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    host = fakeHost(document.createElement('div'));
    new TeardownController(host, {
      teardown: () => calls.push('teardown'),
      rebuild: () => calls.push('rebuild'),
    });
    document.body.append(host);
    host.connect();
  });

  it('does nothing on the first connect', () => {
    expect(calls).toEqual([]);
  });

  it('keeps the state through a move, which re-attaches in the same task', async () => {
    host.remove();
    host.disconnect();
    document.body.append(host);
    host.connect();
    await microtask();

    expect(calls).toEqual([]);
  });

  it('tears down once the host stays detached', async () => {
    host.remove();
    host.disconnect();
    host.disconnect();
    await microtask();

    expect(calls).toEqual(['teardown']);
  });

  it('rebuilds when a torn-down host comes back', async () => {
    host.remove();
    host.disconnect();
    await microtask();
    document.body.append(host);
    host.connect();

    expect(calls).toEqual(['teardown', 'rebuild']);
  });

  it('tears a rebuilt host down again when it leaves again', async () => {
    host.remove();
    host.disconnect();
    await microtask();
    document.body.append(host);
    host.connect();
    host.remove();
    host.disconnect();
    await microtask();

    expect(calls).toEqual(['teardown', 'rebuild', 'teardown']);
  });
});
