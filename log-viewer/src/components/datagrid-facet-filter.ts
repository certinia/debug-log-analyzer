/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { anchoredPopoverStyles } from '../styles/anchoredPopover.styles.js';
import { globalStyles } from '../styles/global.styles.js';

let nextId = 0;

/**
 * Multiselect facet control for the datagrid filter bar's `filters` slot — a
 * compact pill that opens a native-popover checklist of a column's distinct
 * values (replaces per-column `headerFilter: 'list'`). Purely presentational:
 * `values` is the full option list (the host derives it, e.g. from
 * `rootMethod.namespaces` or the row dataset's distinct values); on every
 * toggle it fires `datagrid-facet-change` with the full selected set, and the
 * host owns turning that into a filter predicate.
 */
@customElement('datagrid-facet-filter')
export class DatagridFacetFilter extends LitElement {
  @property() label = '';
  @property({ type: Array }) values: string[] = [];
  /** Reactive mirror of the native `slot` attribute so the element re-renders
   *  when `<overflow-list>` moves it into (`overflow`) / out of its popover. */
  @property({ attribute: 'slot' }) slot = '';

  @state() private _selected = new Set<string>();

  private _anchorName = `--facet-anchor-${nextId++}`;
  private _popoverId = `facet-popover-${nextId}`;

  static styles = [
    globalStyles,
    anchoredPopoverStyles,
    css`
      :host {
        display: inline-flex;
      }

      /* In the overflow panel: aligned label column (shared width) + trigger column. */
      :host([slot='overflow']) {
        display: grid;
        grid-template-columns: var(--filter-panel-label-width) 1fr;
        column-gap: var(--lana-space-sm);
        align-items: center;
        width: 100%;
      }

      :host([slot='overflow']) .facet-trigger {
        justify-self: start;
      }

      .facet-panel__label {
        font-size: var(--filter-control-font-size);
        font-weight: 600;
        color: var(--lana-fg);
      }

      .facet-trigger__count {
        font-weight: 600;
        color: var(--lana-badge-fg);
        background-color: var(--lana-badge-bg);
        border-radius: var(--lana-radius-pill);
        padding: 0 var(--lana-space-2xs);
        font-size: var(--lana-text-xs);
        line-height: 1.5;
        visibility: hidden;
      }

      .facet-trigger__count.visible {
        visibility: visible;
      }

      .facet-trigger__chevron {
        color: var(--lana-fg-muted);
      }

      .facet-popover {
        position-area: bottom span-left;
        margin: var(--lana-space-xs) 0 0 0;
        /* Hug the widest option row's content; never narrower than the
           trigger button itself (anchor-size reads the anchored trigger's
           box — same content-sizing contract as VsSelect's '.dropdown'). */
        width: max-content;
        min-width: anchor-size(width);
        max-width: min(92vw, 280px);
        max-height: min(60vh, 360px);
        overflow-y: auto;
        padding: var(--lana-space-2xs);
      }

      .facet-option {
        display: flex;
        align-items: center;
        gap: var(--lana-space-xs);
      }

      .facet-option span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .facet-popover__empty {
        padding: var(--lana-space-xs) var(--lana-space-sm);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-base);
      }

      .facet-popover__footer {
        margin-top: var(--lana-space-3xs);
        border-top: var(--lana-stroke) solid
          var(--divider-background, var(--vscode-menu-separatorBackground));
      }

      .facet-popover__clear {
        display: block;
        width: 100%;
        padding: var(--lana-space-2xs) var(--lana-space-sm);
        border: none;
        background: none;
        color: var(--lana-link-fg);
        font: inherit;
        font-size: var(--lana-text-base);
        text-align: left;
        cursor: pointer;
        visibility: hidden;
      }

      .facet-popover__clear.visible {
        visibility: visible;
      }

      .facet-popover__clear:hover {
        color: var(--lana-link-fg-active);
      }
    `,
  ];

  /** In the overflow panel, a label column before the same compact trigger, so a long
   *  value list opens in its own popover instead of filling the panel. One template either
   *  way, so a move in or out of the panel keeps the option DOM. */
  render() {
    return html`${
      this.slot === 'overflow'
        ? html`<span class="facet-panel__label" title=${this.label}>${this.label}</span>`
        : nothing
    }${this._renderInline()}`;
  }

  /** Compact bar pill that opens the checklist in a native popover. */
  private _renderInline() {
    const count = this._selected.size;
    return html`
      <button
        class="filter-control facet-trigger ${count > 0 ? 'filter-control--active' : ''}"
        style="anchor-name:${this._anchorName}"
        popovertarget=${this._popoverId}
        title="Filter by ${this.label}"
      >
        <span class="facet-trigger__label">${this.label}</span>
        <span class="facet-trigger__count ${count > 0 ? 'visible' : ''}">${count || 0}</span>
        <vscode-icon
          name="chevron-down"
          aria-hidden="true"
          size="12"
          class="facet-trigger__chevron"
        ></vscode-icon>
      </button>
      <div
        id=${this._popoverId}
        popover
        class="filter-popover facet-popover popover-anchored popover-anchored--hides-with-anchor"
        style="position-anchor:${this._anchorName}"
        role="group"
        aria-label=${this.label}
      >
        ${this._options()}
        <div class="facet-popover__footer">
          <button
            class="facet-popover__clear ${count > 0 ? 'visible' : ''}"
            ?disabled=${count === 0}
            @click=${this.clear}
          >
            Clear
          </button>
        </div>
      </div>
    `;
  }

  private _options() {
    return this.values.length === 0
      ? html`<div class="facet-popover__empty">No values</div>`
      : this.values.map(
          (value) => html`
            <label class="filter-popover-row facet-option">
              <input
                type="checkbox"
                class="vs-checkbox"
                .checked=${this._selected.has(value)}
                @change=${() => this._toggle(value)}
              />
              <span>${value}</span>
            </label>
          `,
        );
  }

  private _toggle(value: string): void {
    const next = new Set(this._selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    this._selected = next;
    this._emit();
  }

  /** Unpicks every value and reports none picked, as the Clear button does. */
  clear(): void {
    this._selected = new Set();
    this._emit();
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent('datagrid-facet-change', {
        detail: { selected: [...this._selected] },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'datagrid-facet-filter': DatagridFacetFilter;
  }
}
