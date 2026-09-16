/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';
import { NO_LOG_TEXT } from './governorCopy.js';

/** The rough layout a section fills once its log arrives. */
export type SkeletonShape = 'gauges' | 'chart' | 'rows' | 'bar';

/** Bar widths per shape, as percentages of the row they sit in. */
const SHAPE_ROWS: Record<SkeletonShape, number[][]> = {
  gauges: [
    [30, 30, 30],
    [30, 30, 30],
  ],
  chart: [[100], [100]],
  rows: [
    [55, 20],
    [55, 20],
    [40, 20],
  ],
  bar: [[100]],
};

/** Bars while the log parses, then a sentence: the section's own where the log
 *  arrived with nothing to draw, and one app-level answer where none arrived. */
@customElement('section-skeleton')
export class SectionSkeleton extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

  @property()
  shape: SkeletonShape = 'rows';

  /** What to say once the log has arrived and there is nothing to draw. */
  @property()
  fallback = '';

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    skeletonStyles,
    css`
      /* One pulsing layer per section rather than per bar: they are inserted
         together and share a timeline, so the two read the same. */
      .bars {
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }

      .row {
        display: flex;
        gap: var(--lana-space-sm);
        padding: var(--lana-space-2xs) 0;
      }

      .bar {
        height: var(--bar-height, 1rem);
        animation: none;
      }

      .shape-chart {
        --bar-height: 2.5rem;
      }

      @media (prefers-reduced-motion: reduce) {
        .bars {
          animation: none;
        }
      }
    `,
  ];

  render() {
    if (this.logStatus === 'failed') {
      return html`<p class="note">${NO_LOG_TEXT}</p>`;
    }
    if (this.logStatus === 'ready') {
      return html`<p class="note">${this.fallback}</p>`;
    }
    // Decoration standing in for content, so there is nothing here to read out.
    return html`<div
      class="bars shape-${this.shape}"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      ${(SHAPE_ROWS[this.shape] ?? SHAPE_ROWS.rows).map(
        (widths) =>
          html`<div class="row">
            ${widths.map(
              (width) =>
                html`<div class="skeleton bar" style="width: ${width}%" aria-hidden="true"></div>`,
            )}
          </div>`,
      )}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'section-skeleton': SectionSkeleton;
  }
}
