/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

type Driver = { connect: () => void; disconnect: () => void };

/** A controller host whose lifecycle a test drives by hand. */
export type FakeHost = ReactiveControllerHost & Driver;

/** Drives the controller hooks by hand. Pass an element for a host read as one. */
export function fakeHost(): FakeHost;
export function fakeHost<E extends Element>(element: E): FakeHost & E;
export function fakeHost(element?: Element): FakeHost {
  const controllers = new Set<ReactiveController>();
  const host = {
    addController: (c: ReactiveController) => void controllers.add(c),
    removeController: (c: ReactiveController) => void controllers.delete(c),
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
    connect: () => controllers.forEach((c) => c.hostConnected?.()),
    disconnect: () => controllers.forEach((c) => c.hostDisconnected?.()),
  };

  return element ? Object.assign(element, host) : host;
}
