/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { initialState, Task, TaskStatus } from '@lit/task';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import { WindowStatsController } from '../core/log/windowStats.js';
import type { LogStore } from '../core/log/LogStore.js';
import { globalStyles } from '../styles/global.styles.js';
import './SectionSkeleton.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { selfTimeByCategory } from '../features/timeline/utils/category-self-time.js';
import { CategoryPaletteController, categorySelfTimes } from './categoryTime.js';
import './StackedTimeBar.js';

/**
 * Self time split by category, as one stacked bar in the flame chart's own
 * palette. Self time, so every nanosecond lands in exactly one segment and the
 * bar always totals its scope.
 *
 * The scope is the window the Timeline is showing, or the whole log when it
 * shows all of it.
 */
@customElement('category-time-bar')
export class CategoryTimeBar extends LitElement {
  private readonly _palette = new CategoryPaletteController(this);
  private readonly _window = new WindowStatsController(this, () => this.logStore?.log ?? null);

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private readonly _slices = new Task(this, {
    task: ([store]) => store?.derive(selfTimeByCategory).then(categorySelfTimes) ?? initialState,
    args: () => [this.logStore],
  });

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    if (this._window.pending) {
      return html`<p class="note">Adding up the self time…</p>`;
    }
    const windowed = this._window.stats;
    const slices = windowed
      ? categorySelfTimes(windowed.selfByCategory)
      : this._slices.status === TaskStatus.COMPLETE
        ? this._slices.value
        : undefined;
    if (!slices?.length) {
      return html`<section-skeleton
        shape="bar"
        ?pending=${!windowed && this._slices.status === TaskStatus.PENDING}
        fallback="No categorised time was recorded in this ${this._window.window ? 'range' : 'log'}."
      ></section-skeleton>`;
    }

    return html`<stacked-time-bar
      legend
      label="Time by category"
      .segments=${slices.map((slice) => ({
        label: slice.category,
        value: slice.selfTime,
        color: this._palette.colorFor(slice.category),
      }))}
    ></stacked-time-bar>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'category-time-bar': CategoryTimeBar;
  }
}
