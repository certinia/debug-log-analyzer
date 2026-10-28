/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';

import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { anchoredPopoverStyles } from '../styles/anchoredPopover.styles.js';
import { globalStyles } from '../styles/global.styles.js';
import type { FilterRange } from './grid/MinMax.js';

let nextId = 0;

const sameRange = (a: FilterRange, b: FilterRange | undefined): boolean =>
  a.start === b?.start && a.end === b?.end;

/**
 * Min/max range control for the datagrid filter bar's `filters` slot — a pill
 * that opens a native-popover with two number inputs (replaces per-column
 * `headerFilter: MinMaxEditor`). Purely presentational: on Enter/blur it fires
 * `datagrid-range-change` with `{ start, end }` (each `null` when empty), and
 * the host owns turning that into a filter predicate.
 */
@customElement('datagrid-range-filter')
export class DatagridRangeFilter extends LitElement {
  @property() label = '';
  /** Optional unit suffix shown on the trigger, e.g. "ms". */
  @property() unit = '';
  /** Reactive mirror of the native `slot` attribute so the element re-renders
   *  when `<overflow-list>` moves it into (`overflow`) / out of its popover. */
  @property({ attribute: 'slot' }) slot = '';
  /** The range on show. A host that binds it owns the value; setting it reports no change. */
  @property({
    attribute: false,
    hasChanged: (value: FilterRange, old?: FilterRange) => !sameRange(value, old),
  })
  range: FilterRange = { start: null, end: null };

  @state() private _start: string = '';
  @state() private _end: string = '';

  private _debounceHandle?: ReturnType<typeof setTimeout>;
  private _anchorName = `--range-anchor-${nextId++}`;
  private _popoverId = `range-popover-${nextId}`;

  static styles = [
    globalStyles,
    anchoredPopoverStyles,
    css`
      :host {
        display: inline-flex;
      }

      /* In the overflow panel the control is a full-width row of inline inputs. */
      :host([slot='overflow']) {
        display: block;
        width: 100%;
      }

      /* Aligned row: label column (shared width) + control column. */
      .range-panel {
        display: grid;
        grid-template-columns: var(--filter-panel-label-width) 1fr;
        align-items: center;
        column-gap: var(--lana-space-sm);
      }

      .range-panel__label {
        grid-column: 1;
        font-size: var(--filter-control-font-size);
        color: var(--lana-fg);
        white-space: nowrap;
      }

      .range-panel__control {
        grid-column: 2;
        display: flex;
        align-items: center;
        gap: var(--lana-space-xs);
      }

      .range-panel__unit {
        font-size: var(--lana-text-sm);
        color: var(--lana-fg-muted);
      }

      .range-trigger {
        font-variant-numeric: tabular-nums;
      }

      .range-trigger__chevron {
        color: var(--lana-fg-muted);
      }

      .range-popover {
        position-area: bottom span-left;
        margin: var(--lana-space-xs) 0 0 0;
        padding: var(--lana-space-sm);
      }

      /* Flex layout only while open — a class-level display would beat the UA
         [popover]:not(:popover-open){display:none} rule and keep the closed
         popover laid out (visible behind other content). */
      .range-popover:popover-open {
        display: flex;
        flex-direction: column;
        gap: var(--lana-space-xs);
      }

      .range-popover__inputs {
        display: flex;
        align-items: center;
        gap: var(--lana-space-xs);
      }

      .range-popover__input {
        width: 8ch;
        box-sizing: border-box;
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        font: inherit;
        font-size: var(--lana-text-base);
        color: var(--vscode-settings-numberInputForeground);
        background-color: var(--vscode-settings-numberInputBackground);
        border: var(--lana-stroke) solid var(--vscode-settings-numberInputBorder, transparent);
        border-radius: var(--lana-radius-sm);
        appearance: textfield;
      }

      .range-popover__input::-webkit-outer-spin-button,
      .range-popover__input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      .range-popover__input:focus {
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-inset);
      }

      .range-popover__clear {
        align-self: flex-start;
        padding: var(--lana-space-3xs) 0;
        border: none;
        background: none;
        color: var(--lana-link-fg);
        font: inherit;
        font-size: var(--lana-text-base);
        cursor: pointer;
      }

      .range-popover__clear:hover {
        color: var(--lana-link-fg-active);
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues<this>): void {
    // A host echoing what was typed would turn "1.50" into "1.5" mid-edit.
    if (changed.has('range') && !sameRange(this.range, this._typed())) {
      this._cancelPending();
      this._start = this.range.start === null ? '' : String(this.range.start);
      this._end = this.range.end === null ? '' : String(this.range.end);
    }
  }

  render() {
    return this.slot === 'overflow' ? this._renderPanel() : this._renderInline();
  }

  /** Compact bar pill that opens the min/max inputs in a native popover. */
  private _renderInline() {
    const active = this._start !== '' || this._end !== '';
    const summary = active
      ? `${this.label}: ${this._start || '…'}–${this._end || '…'}${this.unit}`
      : this.label;

    return html`
      <button
        class="filter-control range-trigger ${active ? 'filter-control--active' : ''}"
        style="anchor-name:${this._anchorName}"
        popovertarget=${this._popoverId}
        aria-haspopup="dialog"
        title="Filter by ${this.label}"
      >
        <span>${summary}</span>
        <vscode-icon
          name="chevron-down"
          aria-hidden="true"
          size="12"
          class="range-trigger__chevron"
        ></vscode-icon>
      </button>
      <div
        id=${this._popoverId}
        popover
        class="filter-popover range-popover popover-anchored popover-anchored--hides-with-anchor"
        style="position-anchor:${this._anchorName}"
        role="dialog"
        aria-label=${this.label}
      >
        ${this._inputs()}
        ${
          active
            ? html`<button class="range-popover__clear" @click=${this._clear}>Clear</button>`
            : ''
        }
      </div>
    `;
  }

  /** Full-width row (inside the overflow panel): label + inline min/max inputs. */
  private _renderPanel() {
    const active = this._start !== '' || this._end !== '';
    return html`
      <div class="range-panel">
        <span class="range-panel__label" title=${this.label}>${this.label}</span>
        <div class="range-panel__control">
          ${this._inputs()}
          ${this.unit ? html`<span class="range-panel__unit">${this.unit}</span>` : ''}
          ${
            active
              ? html`<button class="range-popover__clear" @click=${this._clear}>Clear</button>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private _inputs() {
    return html`<div class="range-popover__inputs">
      <input
        type="number"
        class="range-popover__input"
        placeholder="Min"
        .value=${this._start}
        @input=${this._onInput}
        @keydown=${this._onKeydown}
        @blur=${this._flush}
      />
      <input
        type="number"
        class="range-popover__input"
        placeholder="Max"
        .value=${this._end}
        @input=${this._onInput}
        @keydown=${this._onKeydown}
        @blur=${this._flush}
      />
    </div>`;
  }

  private _onInput(event: Event): void {
    const inputs = this.renderRoot.querySelectorAll<HTMLInputElement>('.range-popover__input');
    this._start = inputs[0]?.value ?? '';
    this._end = inputs[1]?.value ?? '';
    event.stopPropagation();
    clearTimeout(this._debounceHandle);
    this._debounceHandle = setTimeout(() => this._flush(), 150);
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this._flush();
      (event.target as HTMLInputElement).blur();
    }
  }

  // On blur too: a host that resets the range while input is pending would see no change, and the input would come back.
  private _flush(): void {
    if (this._debounceHandle !== undefined) {
      this._cancelPending();
      this._emit();
    }
  }

  private _cancelPending(): void {
    clearTimeout(this._debounceHandle);
    this._debounceHandle = undefined;
  }

  private _clear(): void {
    this._cancelPending();
    this._start = '';
    this._end = '';
    this._emit();
  }

  private _typed(): FilterRange {
    return {
      start: this._start !== '' ? +this._start : null,
      end: this._end !== '' ? +this._end : null,
    };
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent<{ range: FilterRange }>('datagrid-range-change', {
        detail: { range: this._typed() },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'datagrid-range-filter': DatagridRangeFilter;
  }
}
