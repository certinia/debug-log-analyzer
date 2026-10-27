/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '#vscode-elements/vscode-icon.js';
import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  DEBUG_CATEGORY_TOKEN,
  type DebugCategory,
  type Level,
} from '@apexdevtools/apex-log-parser';

// web components
import './OverflowList.js';
import './VsSelect.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { type DebugLevels, LEVEL_ORDER, levelRank, sameLevels } from '../core/log/levelFilter.js';
import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

export interface LogLevelsChange {
  category: DebugCategory;
  level: Level;
}

const levelsChanged = (value: DebugLevels | null, old: DebugLevels | null): boolean =>
  !value || !old ? value !== old : !sameLevels(value, old);

/**
 * The log's debug levels in the app header: one dropdown per category. A level
 * finer than the log captured is disabled. Choosing a level emits
 * `log-levels-change`, and the reset button, live once a level is lowered, emits
 * `log-levels-reset`; the host owns the chosen levels and publishes the log they make.
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

      /* Always in the row, so lowering a level moves nothing. */
      .reset {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: stretch;
        flex: 0 0 auto;
        aspect-ratio: 1;
        padding: 0;
        border: none;
        border-radius: var(--filter-control-radius);
        background: none;
        color: var(--lana-fg);
        cursor: pointer;
        transition:
          opacity 120ms ease-out,
          background-color 120ms ease-out;
      }

      .reset:hover:not(:disabled) {
        background-color: var(--lana-toolbar-hover-bg);
      }

      .reset:focus-visible {
        outline: var(--lana-stroke) solid var(--vscode-focusBorder);
        outline-offset: calc(-1 * var(--lana-stroke));
      }

      .reset:disabled {
        opacity: 0.35;
        cursor: default;
      }

      @media (prefers-reduced-motion: reduce) {
        .reset {
          transition: none;
        }
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

    const lowered = (Object.entries(this.captured) as [DebugCategory, Level][]).filter(
      ([category, captured]) => levelRank(shown[category] ?? captured) < levelRank(captured),
    ).length;
    const resetLabel = lowered
      ? `Reset ${lowered} lowered ${lowered === 1 ? 'level' : 'levels'} to logged`
      : 'All levels as logged';
    const reset = html`<button
      slot="end"
      class="reset"
      type="button"
      aria-label=${resetLabel}
      title=${resetLabel}
      ?disabled=${!lowered}
      @click=${this._onReset}
    >
      <vscode-icon name="discard"></vscode-icon>
    </button>`;
    return html`<overflow-list menu-heading="Log Levels">
      ${repeat(
        Object.entries(this.captured) as [DebugCategory, Level][],
        ([category]) => category,
        ([category, captured]) => {
          const token = DEBUG_CATEGORY_TOKEN[category];
          const level = shown[category] ?? captured;
          return html`<vs-select
            dense
            label=${token}
            prefix=${token}
            prefixSeparator=""
            hint="logged"
            hintValue=${captured}
            .value=${live(level)}
            .filterActive=${levelRank(level) < levelRank(captured)}
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
      ${reset}
    </overflow-list>`;
  }

  private _onChange(category: DebugCategory, event: Event): void {
    const level = (event.target as HTMLInputElement).value as Level;
    // Leaves the app header's shadow root for the log viewer, which owns the levels.
    this.dispatchEvent(
      new CustomEvent<LogLevelsChange>('log-levels-change', {
        detail: { category, level },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onReset(): void {
    this.dispatchEvent(new CustomEvent('log-levels-reset', { bubbles: true, composed: true }));
  }
}
