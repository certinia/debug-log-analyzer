/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import { LitElement } from 'lit';

import { DerivedValue } from '../DerivedValue.js';
import type { LogStore } from '../LogStore.js';

/** A store whose derivations wait until the test lets them land. */
function heldStore(name: string) {
  let land: () => void = () => {};
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });
  const store = {
    derive: async () => {
      await landed;
      return name;
    },
  } as unknown as LogStore;
  return { store, land };
}

class Host extends LitElement {
  static override properties = { logStore: { attribute: false } };
  declare logStore: LogStore | null;
  readonly derived = new DerivedValue(this, () => 'unused');

  constructor() {
    super();
    this.logStore = null;
  }
}
customElements.define('derived-value-host', Host);

async function settle(host: Host): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    await host.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('DerivedValue', () => {
  it('has no value and is not pending without a log', async () => {
    const host = document.createElement('derived-value-host') as Host;
    document.body.append(host);
    await settle(host);

    expect(host.derived.value).toBeUndefined();
    expect(host.derived.pending).toBe(false);
  });

  it("answers with the host's log once its value lands", async () => {
    const first = heldStore('first');
    const host = document.createElement('derived-value-host') as Host;
    host.logStore = first.store;
    document.body.append(host);
    await settle(host);
    expect(host.derived.pending).toBe(true);

    first.land();
    await settle(host);

    expect(host.derived.value).toBe('first');
    expect(host.derived.pending).toBe(false);
  });

  it("never answers with another log's value", async () => {
    const first = heldStore('first');
    const second = heldStore('second');
    const host = document.createElement('derived-value-host') as Host;
    host.logStore = first.store;
    document.body.append(host);
    first.land();
    await settle(host);

    // Read before the host updates, as a willUpdate would.
    host.logStore = second.store;
    expect(host.derived.value).toBeUndefined();
    await settle(host);
    expect(host.derived.value).toBeUndefined();

    second.land();
    await settle(host);
    expect(host.derived.value).toBe('second');
  });
});
