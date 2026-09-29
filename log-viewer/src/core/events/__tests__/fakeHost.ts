/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

type Driver = { connect: () => void; disconnect: () => void };

/** Drives the controller hooks by hand. Pass an element for a host read as one. */
export function fakeHost(): ReactiveControllerHost & Driver;
export function fakeHost<E extends Element>(element: E): ReactiveControllerHost & Driver & E;
export function fakeHost(element?: Element): ReactiveControllerHost & Driver {
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
