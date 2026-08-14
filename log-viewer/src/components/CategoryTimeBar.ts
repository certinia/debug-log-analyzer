/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
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

  /** The bar has to follow the log itself. */
  private readonly _logLoaded = new LogLoadedController(this);

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    const apexLog = DatabaseAccess.instance()?.getApexLog();
    const slices = apexLog ? categorySelfTimes(apexLog) : [];
    if (!slices.length) {
      return html`<p class="note">No categorised time was recorded in this log.</p>`;
    }

    return html`<stacked-time-bar
      legend
      label="Time by category"
      .segments=${slices.map((slice) => ({
        label: slice.category,
        timeNs: slice.selfTime,
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
