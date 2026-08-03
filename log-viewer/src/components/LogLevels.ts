/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type { DebugLevel } from 'apex-log-parser';

// web components
import './OverflowList.js';
import './VsChip.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

/**
 * Read-only display of the log's captured debug levels in the app header: one chip per
 * category (`CATEGORY LEVEL`), styled as a VS Code dropdown face. A thin adapter — the
 * responsive overflow-into-a-menu behaviour lives in `<overflow-list>` and the chip face
 * in `<vs-chip>`.
 *
 * MIGRATION TO FILTERS: each chip is read-only display. To make levels filterable, this
 * template is the single seam that changes:
 *   1. swap `<vs-chip>` for `<vs-select compact>` (chevron returns);
 *   2. reintroduce level ordering + ceiling helpers (removed `logLevelsFormat.ts`:
 *      `LEVEL_ORDER`/`rankOf`/`ceilingHint`) and the `VsSelect` compact + disabled-option
 *      tooltip additions;
 *   3. add a `filters` Map (per-category chosen level) + a `@change` handler that emits
 *      `log-levels-change`, and have views subscribe to hide events above the threshold.
 * `<overflow-list>` measures whatever it's given, so overflow + alignment are unaffected.
 */
@customElement('log-levels')
export class LogLevels extends LitElement {
  @property()
  logSettings: DebugLevel[] | null = null;

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        font-size: 11px;
      }

      .skeletons {
        display: flex;
        gap: 6px;
      }

      .item-skeleton {
        width: 92px;
        height: 18px;
        border-radius: 4px;
        flex: 0 0 auto;
      }
    `,
  ];

  render() {
    if (!this.logSettings) {
      return html`<div class="skeletons">
        ${repeat(
          Array.from({ length: 6 }),
          (_, i) => i,
          () => html`<div class="item-skeleton skeleton"></div>`,
        )}
      </div>`;
    }

    return html`<overflow-list menu-heading="Log levels">
      ${repeat(
        this.logSettings,
        (s) => s.logCategory,
        (s) => html`<vs-chip><span slot="lead">${s.logCategory}</span>${s.logLevel}</vs-chip>`,
      )}
    </overflow-list>`;
  }
}
