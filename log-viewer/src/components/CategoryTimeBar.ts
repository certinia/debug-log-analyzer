/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { CategoryPaletteController, categorySelfTimes } from './categoryTime.js';
import './StackedTimeBar.js';

/**
 * The whole log's self time split by category, as one stacked bar in the flame
 * chart's own palette — the Inspector's answer to Chrome DevTools' Summary
 * donut. Self time, so every nanosecond lands in exactly one segment and the bar
 * always totals the log.
 */
@customElement('category-time-bar')
export class CategoryTimeBar extends LitElement {
  private readonly _palette = new CategoryPaletteController(this);

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    const apexLog = this.logStore?.log;
    const slices = apexLog ? categorySelfTimes(apexLog) : [];
    if (!slices.length) {
      return html`<p class="note">No categorised time was recorded in this log.</p>`;
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
