/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DerivedValue } from '../core/log/DerivedValue.js';
import { logContext } from '../core/log/logContext.js';
import type { Derivation, LogStore } from '../core/log/LogStore.js';
import { globalStyles } from '../styles/global.styles.js';
import './SectionSkeleton.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { selfTimeByCategory } from '../features/timeline/utils/category-self-time.js';
import { type CategoryTime, CategoryPaletteController, categorySelfTimes } from './categoryTime.js';
import './StackedTimeBar.js';

const categorySlices: Derivation<CategoryTime[]> = async (_, store) =>
  categorySelfTimes(await store.derive(selfTimeByCategory));

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

  private readonly _slices = new DerivedValue(this, categorySlices);

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    const slices = this._slices.value;
    if (!slices?.length) {
      return html`<section-skeleton
        shape="bar"
        ?pending=${this._slices.pending}
        fallback="No categorised time was recorded in this log."
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
