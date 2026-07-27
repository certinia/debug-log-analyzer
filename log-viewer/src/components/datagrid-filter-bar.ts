/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

// components
import './Divider.js';

/**
 * Shared grid toolbar. Content is grouped into sections, left→right:
 *   global · table-actions · filters   (left cluster)
 *   group · actions                    (right cluster, right-aligned)
 * A vertical divider is drawn between adjacent non-empty sections; the flexible
 * gap separates the left cluster from the right-aligned grouping/actions.
 */
@customElement('datagrid-filter-bar')
export class DatagridFilterBar extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .filter-bar {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        width: 100%;
      }

      .filter-bar__left,
      .filter-bar__right {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        /* Allow the clusters to shrink below content width so a section's
           overflow-list receives a constrained width and can collapse. */
        min-width: 0;
      }

      /* Left cluster consumes the slack (via its growable filters section) so a
         collapsed overflow-list regains width and can re-expand on widen; the
         right cluster then sits at the far edge with no growth. */
      .filter-bar__left {
        flex: 1 1 auto;
      }

      .filter-bar__right {
        flex: 0 0 auto;
      }

      .section {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        /* Shrinkable so the filters section can hand its overflow-list a
           bounded width (min-width:auto would keep it at content size). */
        min-width: 0;
      }

      /* Filters section takes the left cluster's slack and passes it to its
         slotted overflow-list, so the list always knows the full width
         available and can re-expand collapsed items when the bar widens. */
      .section--grow {
        flex: 1 1 auto;
      }

      .section--grow ::slotted([slot='filters']) {
        flex: 1 1 auto;
        min-width: 0;
      }

      .section[hidden] {
        display: none;
      }

      divider-line {
        align-self: stretch;
        margin: 2px 0;
      }
    `,
  ];

  @state() private _hasGlobal = false;
  @state() private _hasTableActions = false;
  @state() private _hasFilters = false;
  @state() private _hasGroup = false;
  @state() private _hasActions = false;

  private _slotChange(
    prop: '_hasGlobal' | '_hasTableActions' | '_hasFilters' | '_hasGroup' | '_hasActions',
  ) {
    return (event: Event) => {
      this[prop] = (event.target as HTMLSlotElement).assignedElements().length > 0;
    };
  }

  private _divider() {
    return html`<divider-line orientation="vertical"></divider-line>`;
  }

  render() {
    // Dividers sit between adjacent non-empty sections within each cluster.
    const tableActionsDivider = this._hasGlobal && this._hasTableActions;
    const filtersDivider = this._hasFilters && (this._hasGlobal || this._hasTableActions);
    const actionsDivider = this._hasGroup && this._hasActions;

    // Empty sections are hidden so they don't add stray gaps.
    return html`<div class="filter-bar">
      <div class="filter-bar__left">
        <div class="section" ?hidden=${!this._hasGlobal}>
          <slot name="global" @slotchange=${this._slotChange('_hasGlobal')}></slot>
        </div>
        ${tableActionsDivider ? this._divider() : nothing}
        <div class="section" ?hidden=${!this._hasTableActions}>
          <slot name="table-actions" @slotchange=${this._slotChange('_hasTableActions')}></slot>
        </div>
        ${filtersDivider ? this._divider() : nothing}
        <div class="section section--grow" ?hidden=${!this._hasFilters}>
          <slot name="filters" @slotchange=${this._slotChange('_hasFilters')}></slot>
        </div>
      </div>

      <div class="filter-bar__right">
        <div class="section" ?hidden=${!this._hasGroup}>
          <slot name="group" @slotchange=${this._slotChange('_hasGroup')}></slot>
        </div>
        ${actionsDivider ? this._divider() : nothing}
        <div class="section" ?hidden=${!this._hasActions}>
          <slot name="actions" @slotchange=${this._slotChange('_hasActions')}></slot>
        </div>
      </div>
    </div>`;
  }
}
