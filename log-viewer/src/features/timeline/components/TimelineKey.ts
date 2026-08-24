/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { formatDuration } from '../../../core/utility/Util.js';

// web components
import '../../../components/ColorSwatch.js';
import '../../../components/OverflowList.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

/** One legend chip: category color dot, label, and (when known) the log's self time in that category. */
export interface TimelineKeyEntry {
  label: string;
  fillColor: string;
  /** Total self time (ns) spent in this category; omitted on the legacy timeline. */
  selfTimeNs?: number;
}

@customElement('timeline-key')
export class Timelinekey extends LitElement {
  @property()
  timelineKeys: TimelineKeyEntry[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        font-size: var(--lana-text-base);
        color: var(--lana-fg-muted);
        white-space: nowrap;
      }

      /* The time is the data: full foreground against the muted label, and figure
         widths that line up chip to chip without leaving the UI font. */
      .chip__time {
        font-variant-numeric: tabular-nums;
        color: var(--lana-fg);
      }
    `,
  ];

  render() {
    return html`<overflow-list menu-heading="Categories" gap="12">
      ${repeat(
        this.timelineKeys,
        (entry) => entry.label,
        (entry) =>
          // data-category is the seam for the interactivity follow-up (hover/click → highlight).
          html`<span class="chip" data-category="${entry.label}">
            <color-swatch color=${entry.fillColor} label=${entry.label}></color-swatch>
            <span>${entry.label}</span>
            ${
              entry.selfTimeNs !== undefined
                ? html`<span class="chip__time"
                    >${formatDuration(entry.selfTimeNs, { compact: true })}</span
                  >`
                : ''
            }
          </span>`,
      )}
    </overflow-list>`;
  }
}
