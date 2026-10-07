/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { initialState, Task, TaskStatus } from '@lit/task';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import { WindowStatsController } from '../core/log/windowStats.js';
import { type LogIndex, NO_ROW } from '../core/log/LogIndex.js';
import type { LogStore } from '../core/log/LogStore.js';
import { globalStyles } from '../styles/global.styles.js';
import './SectionSkeleton.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { segmentsWithTail } from './StackedTimeBar.js';
import './StackedTimeBar.js';
import { logNamespacePalette } from './namespacePalette.js';
import {
  namespaceColumn,
  namespaceSelfTimes,
  toNamespaceTimes,
  type NamespaceTime,
} from './namespaceTime.js';

// Null for the whole log.
function scopeRows(index: LogIndex, scope: number | readonly number[]): number[] | null {
  const indexes = typeof scope !== 'number' ? scope : scope >= 0 ? [scope] : null;
  return indexes?.map((each) => index.rowOf(each)).filter((row) => row !== NO_ROW) ?? null;
}

/**
 * Self time split by the namespace whose code ran it: whose package burned the
 * time, which no grid says. Self time, so every nanosecond lands in exactly one
 * namespace.
 *
 * Whole log with no `eventIndex`, otherwise the selected frame and everything
 * below it, so the same section answers "and inside this method?". Narrowed
 * again to the window the Timeline is showing, when it shows part of the log.
 *
 * One namespace still gets its bar: that a scope mixes no packages is an answer,
 * and the full bar with its figure says it.
 */
@customElement('namespace-time-bar')
export class NamespaceTimeBar extends LitElement {
  /** The frame to scope to, with its descendants. Below zero: the whole log. */
  @property({ type: Number })
  eventIndex = -1;

  /** Every occurrence of an aggregated row, summed as one scope. */
  @property({ attribute: false })
  instances: number[] | null = null;

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _slices = new Task(this, {
    task: async ([store, scope]) => {
      if (!store) {
        return initialState;
      }
      const [index, column] = await Promise.all([store.logIndex(), store.derive(namespaceColumn)]);
      return { store, slices: namespaceSelfTimes(index, column, scopeRows(index, scope)) };
    },
    // Instances win over the frame, so stepping through them is no new scope.
    args: () => [this.logStore, this.instances?.length ? this.instances : this.eventIndex],
  });

  private readonly _window = new WindowStatsController(this, () => this.logStore?.log ?? null);

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    let slices: NamespaceTime[] | null;
    if (this._windowScoped()) {
      const windowed = this._window.stats;
      slices = windowed ? toNamespaceTimes(windowed.selfByNamespace) : null;
    } else {
      const { status, value } = this._slices;
      // A new scope in the same log keeps the last bar until its sum lands.
      const shown = value?.store === this.logStore ? value : undefined;
      slices = shown?.slices ?? (status === TaskStatus.PENDING ? null : []);
    }
    if (!slices) {
      return html`<section-skeleton
        shape="bar"
        fallback="Adding up the self time…"
      ></section-skeleton>`;
    }
    const log = this.logStore?.log;
    if (!slices.length || !log) {
      return html`<p class="note">No time was recorded here.</p>`;
    }
    const color = logNamespacePalette(log);
    const segments = segmentsWithTail(slices, (slice) => ({
      label: slice.namespace,
      value: slice.selfTime,
      color: color(slice.namespace),
    }));

    return html`<stacked-time-bar
      legend
      label="Self time by namespace"
      .segments=${segments}
    ></stacked-time-bar>`;
  }

  /** True where the section answers for a picked frame or aggregate. */
  private _selected(): boolean {
    return this.eventIndex >= 0 || !!this.instances?.length;
  }

  /** True where the window is the scope. A selection wins over it: a picked
   *  frame is answered as itself, wherever the timeline is looking. */
  private _windowScoped(): boolean {
    return !this._selected() && this._window.window !== null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'namespace-time-bar': NamespaceTimeBar;
  }
}
