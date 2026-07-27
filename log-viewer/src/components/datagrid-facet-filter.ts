/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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
    css`
      :host {
        display: inline-flex;
      }

      /* In the overflow panel the control is a full-width row: label + checklist. */
      :host([slot='overflow']) {
        display: block;
        width: 100%;
      }

      /* Aligned row: label column (shared width) + control column. */
      .facet-panel {
        display: grid;
        grid-template-columns: var(--filter-panel-label-width) 1fr;
        column-gap: 8px;
        row-gap: 4px;
        align-items: start;
      }

      .facet-panel__label {
        grid-column: 1;
        font-size: var(--filter-control-font-size);
        font-weight: 600;
        color: var(--vscode-foreground);
        /* Nudge onto the first option row's baseline. */
        padding-top: 3px;
      }

      .facet-panel__options {
        grid-column: 2;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
      }

      .facet-panel .facet-popover__clear {
        grid-column: 2;
        width: auto;
        padding: 2px 0;
      }

      .facet-trigger__count {
        font-weight: 600;
        color: var(--vscode-badge-foreground);
        background-color: var(--vscode-badge-background);
        border-radius: 999px;
        padding: 0 5px;
        font-size: 10px;
        line-height: 1.5;
        visibility: hidden;
      }

      .facet-trigger__count.visible {
        visibility: visible;
      }

      .facet-trigger__chevron {
        color: var(--vscode-descriptionForeground);
      }

      .facet-popover {
        position: fixed;
        position-area: bottom span-left;
        /* Flip above / to the other side when the default placement would run
           off-screen, so every value stays visible. */
        position-try-fallbacks:
          flip-block,
          flip-inline,
          flip-block flip-inline;
        /* Auto-hide when the trigger scrolls out of view instead of stranding
           at stale fixed coords in the top layer. */
        position-visibility: anchors-visible;
        inset: auto;
        margin: 6px 0 0 0;
        /* Hug the widest option row's content; never narrower than the
           trigger button itself (anchor-size reads the anchored trigger's
           box — same content-sizing contract as VsSelect's '.dropdown'). */
        width: max-content;
        min-width: anchor-size(width);
        max-width: min(92vw, 280px);
        max-height: min(60vh, 360px);
        overflow-y: auto;
        padding: 4px;
      }

      .facet-option {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .facet-option span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .facet-popover__empty {
        padding: 6px 8px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }

      .facet-popover__footer {
        margin-top: 2px;
        border-top: 1px solid var(--divider-background, var(--vscode-menu-separatorBackground));
      }

      .facet-popover__clear {
        display: block;
        width: 100%;
        padding: 4px 8px;
        border: none;
        background: none;
        color: var(--vscode-textLink-foreground);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
        visibility: hidden;
      }

      .facet-popover__clear.visible {
        visibility: visible;
      }

      .facet-popover__clear:hover {
        color: var(--vscode-textLink-activeForeground);
      }
    `,
  ];

  render() {
    return this.slot === 'overflow' ? this._renderPanel() : this._renderInline();
  }

  /** Compact bar pill that opens the checklist in a native popover. */
  private _renderInline() {
    const count = this._selected.size;
    return html`
      <button
        class="filter-control facet-trigger ${count > 0 ? 'filter-control--active' : ''}"
        style="anchor-name:${this._anchorName}"
        popovertarget=${this._popoverId}
        aria-haspopup="listbox"
        title=${this.label}
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
        class="filter-popover facet-popover"
        style="position-anchor:${this._anchorName}"
        role="listbox"
        aria-label=${this.label}
      >
        ${this._options()}
        <div class="facet-popover__footer">
          <button
            class="facet-popover__clear ${count > 0 ? 'visible' : ''}"
            ?disabled=${count === 0}
            @click=${this._clear}
          >
            Clear
          </button>
        </div>
      </div>
    `;
  }

  /** Full-width row (inside the overflow panel): label + inline checklist. */
  private _renderPanel() {
    const count = this._selected.size;
    return html`
      <div class="facet-panel" role="group" aria-label=${this.label}>
        <span class="facet-panel__label" title=${this.label}>${this.label}</span>
        <div class="facet-panel__options">${this._options()}</div>
        ${
          count > 0
            ? html`<button class="facet-popover__clear visible" @click=${this._clear}>
                Clear
              </button>`
            : ''
        }
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

  private _clear(): void {
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
