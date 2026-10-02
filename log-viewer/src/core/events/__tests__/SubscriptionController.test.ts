/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { LitElement, html } from 'lit';

import { SubscriptionController } from '../SubscriptionController.js';
import { fakeHost } from '#test-helpers/fakeHost.js';

describe('SubscriptionController', () => {
  it('subscribes on connect, not while it is built', () => {
    const host = fakeHost();
    let opened = 0;

    new SubscriptionController(host, () => {
      opened++;
      return [];
    });

    expect(opened).toBe(0);
    host.connect();
    expect(opened).toBe(1);
  });

  it('releases every subscription on disconnect', () => {
    const host = fakeHost();
    const closed: string[] = [];
    new SubscriptionController(host, () => [
      () => void closed.push('first'),
      () => void closed.push('second'),
    ]);

    host.connect();
    expect(closed).toEqual([]);

    host.disconnect();
    expect(closed).toEqual(['first', 'second']);
  });

  it('subscribes again after a re-attach', () => {
    const host = fakeHost();
    let opened = 0;
    let closed = 0;
    new SubscriptionController(host, () => {
      opened++;
      return [() => void closed++];
    });

    host.connect();
    host.disconnect();
    host.connect();

    expect(opened).toBe(2);
    expect(closed).toBe(1);
  });

  it('replaces its subscriptions when connected twice without a disconnect', () => {
    const host = fakeHost();
    let opened = 0;
    let closed = 0;
    new SubscriptionController(host, () => {
      opened++;
      return [() => void closed++];
    });

    host.connect();
    host.connect();

    expect(opened).toBe(2);
    expect(closed).toBe(1);

    host.disconnect();
    expect(closed).toBe(2);
  });

  it('releases nothing twice when disconnected twice', () => {
    const host = fakeHost();
    let closed = 0;
    new SubscriptionController(host, () => [() => void closed++]);

    host.connect();
    host.disconnect();
    host.disconnect();

    expect(closed).toBe(1);
  });

  it('reads a field declared after it, which the host lifecycle defers', async () => {
    const seen: string[] = [];

    class LateFieldHost extends LitElement {
      readonly subscriptions = new SubscriptionController(this, () => {
        seen.push(this.name);
        return [];
      });
      readonly name = 'declared after the controller';

      override render() {
        return html`<span></span>`;
      }
    }
    customElements.define('late-field-host', LateFieldHost);

    const el = new LateFieldHost();
    document.body.appendChild(el);
    await el.updateComplete;
    el.remove();

    expect(seen).toEqual(['declared after the controller']);
  });
});
