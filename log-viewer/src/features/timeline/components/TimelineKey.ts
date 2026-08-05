/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { formatDuration } from '../../../core/utility/Util.js';

// web components
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
        font-size: var(--lana-text-md);
        color: var(--lana-fg-muted);
        white-space: nowrap;
      }

      .chip__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
      }

      /* The time is the data: mono like the header vitals, full foreground against the muted label. */
      .chip__time {
        font-family: var(--vscode-editor-font-family, monospace);
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
            <span class="chip__dot" style="background-color: ${entry.fillColor}"></span>
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
