/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';

let nextId = 0;

export type FilterRange = { start: number | null; end: number | null };

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

  @state() private _start: string = '';
  @state() private _end: string = '';

  private _debounceHandle?: ReturnType<typeof setTimeout>;
  private _anchorName = `--range-anchor-${nextId++}`;
  private _popoverId = `range-popover-${nextId}`;

  static styles = [
    globalStyles,
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
        column-gap: 8px;
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
        gap: 6px;
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
        position: fixed;
        position-area: bottom span-left;
        /* Flip above / to the other side when the default placement would run
           off-screen so the inputs stay visible. */
        position-try-fallbacks:
          flip-block,
          flip-inline,
          flip-block flip-inline;
        /* Auto-hide when the trigger scrolls out of view instead of stranding
           at stale fixed coords in the top layer. */
        position-visibility: anchors-visible;
        inset: auto;
        margin: 6px 0 0 0;
        padding: 8px;
      }

      /* Flex layout only while open — a class-level display would beat the UA
         [popover]:not(:popover-open){display:none} rule and keep the closed
         popover laid out (visible behind other content). */
      .range-popover:popover-open {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .range-popover__inputs {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .range-popover__input {
        width: 8ch;
        box-sizing: border-box;
        padding: 3px 6px;
        font: inherit;
        font-size: var(--lana-text-base);
        color: var(--vscode-settings-numberInputForeground);
        background-color: var(--vscode-settings-numberInputBackground);
        border: 1px solid var(--vscode-settings-numberInputBorder, transparent);
        border-radius: 4px;
        appearance: textfield;
      }

      .range-popover__input::-webkit-outer-spin-button,
      .range-popover__input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      .range-popover__input:focus {
        outline: 1px solid var(--lana-focus-border);
        outline-offset: -1px;
      }

      .range-popover__clear {
        align-self: flex-start;
        padding: 2px 0;
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
        title=${this.label}
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
        class="filter-popover range-popover"
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
      />
      <input
        type="number"
        class="range-popover__input"
        placeholder="Max"
        .value=${this._end}
        @input=${this._onInput}
        @keydown=${this._onKeydown}
      />
    </div>`;
  }

  private _onInput(event: Event): void {
    const inputs = this.renderRoot.querySelectorAll<HTMLInputElement>('.range-popover__input');
    this._start = inputs[0]?.value ?? '';
    this._end = inputs[1]?.value ?? '';
    event.stopPropagation();
    clearTimeout(this._debounceHandle);
    this._debounceHandle = setTimeout(() => this._emit(), 150);
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      clearTimeout(this._debounceHandle);
      this._emit();
      (event.target as HTMLInputElement).blur();
    }
  }

  private _clear(): void {
    clearTimeout(this._debounceHandle);
    this._start = '';
    this._end = '';
    this._emit();
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent<{ range: FilterRange }>('datagrid-range-change', {
        detail: {
          range: {
            start: this._start !== '' ? +this._start : null,
            end: this._end !== '' ? +this._end : null,
          },
        },
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
