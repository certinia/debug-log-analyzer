/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { initialState, Task, TaskStatus } from '@lit/task';
import type { ReactiveControllerHost } from 'lit';

import type { Derivation, LogStore } from './LogStore.js';

/** A host that shows one log, from the log context. */
type LogHost = ReactiveControllerHost & HTMLElement & { logStore: LogStore | null };

/**
 * `fn` derived from the host's log, re-run when the log changes.
 *
 * {@link value} only ever answers for the log the host shows now, so a host can
 * read it anywhere in its update, before the new run has started.
 */
export class DerivedValue<T> {
  private readonly host: LogHost;
  private readonly task: Task<[LogStore | null], { store: LogStore; value: T }>;

  constructor(host: LogHost, fn: Derivation<T>) {
    this.host = host;
    this.task = new Task(host, {
      task: async ([store]) => (store ? { store, value: await store.derive(fn) } : initialState),
      args: () => [host.logStore],
    });
  }

  /** The value for the host's log; undefined while it loads, or if it failed. */
  get value(): T | undefined {
    const done = this.task.value;
    return done?.store === this.host.logStore ? done.value : undefined;
  }

  /** True while the value for the host's log is still being derived. */
  get pending(): boolean {
    return this.task.status === TaskStatus.PENDING;
  }
}
