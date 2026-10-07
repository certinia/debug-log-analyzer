/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import type { LogCategory } from '@apexdevtools/apex-log-parser';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { formatDuration } from '../../../core/utility/Util.js';
import { isDeselectEscape } from '../../app/escapeDeselect.js';
import { HoverIntentController } from './HoverIntentController.js';

// web components
import '../../../components/ColorSwatch.js';
import '../../../components/OverflowList.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

/** One legend chip: colour dot, category, and (when known) the log's self time under it. */
export interface TimelineKeyEntry {
  category: LogCategory;
  fillColor: string;
  /** Self time (ns) under {@link category}; omitted where no log is loaded. */
  selfTimeNs?: number;
}

/**
 * Emits `highlight-change` (detail: the categories to keep lit) whenever they change: a chip
 * clicked on or off, a preview where the pointer rests or keyboard focus lands, or Escape.
 */
@customElement('timeline-key')
export class Timelinekey extends LitElement {
  @property()
  timelineKeys: TimelineKeyEntry[] = [];

  @state()
  private picked: ReadonlySet<string> = new Set();

  @state()
  private previewed: string | null = null;

  private readonly hoverIntent = new HoverIntentController<string>(this, (category) => {
    this.previewed = category;
    this.emitLit();
  });

  /**
   * Drops every picked category. A preview in progress stays.
   * @returns Whether any was picked
   */
  clear(): boolean {
    if (!this.picked.size) {
      return false;
    }
    this.picked = new Set();
    this.emitLit();
    return true;
  }

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
        padding: var(--lana-space-3xs) var(--lana-space-2xs);
        border: var(--lana-stroke) solid transparent;
        border-radius: var(--lana-radius-sm);
        background: none;
        font: inherit;
        font-size: var(--lana-text-base);
        color: var(--lana-fg-muted);
        white-space: nowrap;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }

      .chip:hover {
        color: var(--lana-fg);
      }

      .chip:focus-visible {
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-offset);
      }

      /* The time is the data: full foreground against the muted label, and figure
         widths that line up chip to chip without leaving the UI font. */
      .chip__time {
        font-variant-numeric: tabular-nums;
        color: var(--lana-fg);
      }

      /* Greyed as the chart greys that category's frames. */
      .chip--unlit color-swatch {
        filter: grayscale(1);
        transition: filter 0.15s ease;
      }

      .chip--unlit .chip__time {
        color: var(--lana-fg-muted);
      }

      @media (prefers-reduced-motion: reduce) {
        .chip,
        .chip--unlit color-swatch {
          transition: none;
        }
      }
    `,
  ];

  render() {
    const lit = this.lit;
    return html`<overflow-list menu-heading="Categories" gap="12">
      ${repeat(
        this.timelineKeys,
        (entry) => entry.category,
        (entry) =>
          html`<button
            type="button"
            class="chip pill-toggle ${lit.size && !lit.has(entry.category) ? 'chip--unlit' : ''}"
            data-category="${entry.category}"
            aria-pressed=${this.picked.has(entry.category) ? 'true' : 'false'}
            @click=${() => this.toggle(entry.category)}
            @pointerenter=${() => this.hoverIntent.enter(entry.category)}
            @pointerleave=${() => this.hoverIntent.leave()}
            @focus=${(event: FocusEvent) => this.onFocus(event, entry.category)}
            @blur=${() => this.hoverIntent.blur()}
            @keydown=${this.onKeydown}
          >
            <color-swatch color=${entry.fillColor}></color-swatch>
            <span>${entry.category}</span>
            ${
              entry.selfTimeNs !== undefined
                ? html`<span class="chip__time"
                    >${formatDuration(entry.selfTimeNs, { compact: true })}</span
                  >`
                : ''
            }
          </button>`,
      )}
    </overflow-list>`;
  }

  // Not on the focus a mouse click leaves behind: only keyboard focus previews.
  private onFocus(event: FocusEvent, category: string): void {
    if ((event.target as HTMLElement).matches(':focus-visible')) {
      this.hoverIntent.focus(category);
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    // Only an Escape the app-wide deselect would take: the "+N" menu closes first.
    if (!this.picked.size || !isDeselectEscape(event)) {
      return;
    }
    // Consumed, so the app-wide Escape does not also drop the selection.
    event.preventDefault();
    this.clear();
  }

  private toggle(category: string): void {
    const picked = new Set(this.picked);
    if (!picked.delete(category)) {
      picked.add(category);
    }
    this.picked = picked;
    this.emitLit();
  }

  // A preview adds to the picks and never hides them.
  private get lit(): ReadonlySet<string> {
    return this.previewed ? new Set(this.picked).add(this.previewed) : this.picked;
  }

  private emitLit(): void {
    this.dispatchEvent(new CustomEvent('highlight-change', { detail: this.lit }));
  }
}
