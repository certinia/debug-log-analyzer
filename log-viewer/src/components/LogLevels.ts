/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';

import type { DebugLevels, LogLevel } from '@apexdevtools/apex-log-parser';

// web components
import './OverflowList.js';
import './VsSelect.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { LEVEL_ORDER, levelRank, sameLevels } from '../core/log/levelFilter.js';
import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

/** The token the log's settings line names each category by; `DebugLevels` keys them in camelCase. */
const LOG_TOKEN: Record<keyof DebugLevels, string> = {
  apexCode: 'APEX_CODE',
  apexProfiling: 'APEX_PROFILING',
  callout: 'CALLOUT',
  dataAccess: 'DATA_ACCESS',
  database: 'DB',
  nba: 'NBA',
  system: 'SYSTEM',
  validation: 'VALIDATION',
  visualforce: 'VISUALFORCE',
  wave: 'WAVE',
  workflow: 'WORKFLOW',
};

export interface LogLevelsChange {
  category: keyof DebugLevels;
  level: LogLevel;
}

const levelsChanged = (value: DebugLevels | null, old: DebugLevels | null): boolean =>
  !value || !old ? value !== old : !sameLevels(value, old);

/**
 * The log's debug levels in the app header: one dropdown per category. A level
 * finer than the log captured is disabled. Choosing a level emits
 * `log-levels-change`; the host owns the chosen levels and publishes the log they make.
 * The responsive overflow-into-a-menu behaviour lives in `<overflow-list>`.
 */
@customElement('log-levels')
export class LogLevels extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

  /** The levels the log was captured at: the finest each dropdown offers. */
  @property({ attribute: false, hasChanged: levelsChanged })
  captured: DebugLevels | null = null;

  /** The levels chosen, which the log on screen is filtered to. */
  @property({ attribute: false, hasChanged: levelsChanged })
  chosen: DebugLevels | null = null;

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        font-size: var(--lana-text-sm);
      }

      /* The face of a resting chip, not a filter-bar pill: the
         row reads as the log's settings line. */
      vs-select {
        --filter-control-height: auto;
        --filter-control-padding: var(--lana-space-3xs) var(--lana-space-xs);
        --filter-control-font-size: var(--lana-text-xs);
        --filter-control-line-height: normal;

        font-family: var(--lana-font-mono);
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
    const shown = this.chosen ?? {};
    if (!this.captured) {
      if (this.logStatus !== 'parsing') {
        return nothing;
      }
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
        Object.entries(this.captured) as [keyof DebugLevels, LogLevel][],
        ([category]) => category,
        ([category, captured]) => {
          const token = LOG_TOKEN[category];
          const level = shown[category] ?? captured;
          return html`<vs-select
            dense
            emptyValue=""
            label=${token}
            prefix=${token}
            prefixSeparator=""
            .value=${live(level)}
            @change=${(event: Event) => this._onChange(category, event)}
          >
            ${LEVEL_ORDER.map((option) => {
              const uncaptured = levelRank(option) > levelRank(captured);
              return html`<vscode-option
                value=${option}
                ?selected=${option === level}
                ?disabled=${uncaptured}
                >${option}</vscode-option
              >`;
            })}
          </vs-select>`;
        },
      )}
    </overflow-list>`;
  }

  private _onChange(category: keyof DebugLevels, event: Event): void {
    const level = (event.target as HTMLInputElement).value as LogLevel;
    // Leaves the app header's shadow root for the log viewer, which owns the levels.
    this.dispatchEvent(
      new CustomEvent<LogLevelsChange>('log-levels-change', {
        detail: { category, level },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
