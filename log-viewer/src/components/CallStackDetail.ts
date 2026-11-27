/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import './grid/AppGrid.js';
import { LitElement, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';

import { max, sum, type GridColumn, type TreeSource } from '../grid/index.js';
import { queryDialect } from '../features/call-tree/grid/cells.js';
import { globalStyles } from '../styles/global.styles.js';
import { buildCallStackData, type CallStackRow } from './callStackData.js';
import type { AppGrid } from './grid/AppGrid.js';
import { inlineQueryColumn, timeColumn } from './grid/columns.js';
import { InspectorGridController, inspectorGridStyles } from './grid/InspectorGridController.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from './inspectorReveal.js';

/**
 * The lineage of parent frames that led to an event, outermost first, as a
 * small grid (Frame | Total | Self) that mirrors the Call Tree: the same bars
 * (percent of the stack's root frame), column headers and resizable columns.
 *
 * The list is anchored: `eventId` is the frame the stack was built for and
 * never moves while the user walks it. Clicking a frame makes it the active one
 * — the row the rest of the inspector follows — which the inspector feeds back
 * as `activeEventId`, so no frame is lost on the way down.
 */
@customElement('call-stack-detail')
export class CallStackDetail extends LitElement {
  /** The frame the stack was built for; the list stays anchored to it. */
  @property({ type: Number })
  eventId = -1;

  /** The frame in the stack the inspector is following. */
  @property({ type: Number })
  activeEventId = -1;

  @state()
  private _source: TreeSource<CallStackRow> | null = null;
  @state()
  private _columns: GridColumn<CallStackRow>[] = [];

  private readonly _grid = createRef<AppGrid<CallStackRow>>();
  private _frames: ReadonlySet<number> = new Set();

  private readonly _inspector = new InspectorGridController<CallStackRow>(this, {
    grid: () => this._grid.value ?? null,
    source: () => this._source,
    frameIds: (row) => [row.eventId],
    // Selecting a frame makes it the active one and reveals it in the tab on
    // screen; the inspector adds the source, since only it knows which tab that is.
    pick: (row) => {
      if (row) {
        dispatchInspectorReveal(this, row.eventId);
      } else {
        // A click on the selected row clears it, but its frame is still the active one.
        void this._inspector.selectActive(this.activeEventId >= 0 ? [this.activeEventId] : null);
      }
    },
    menuFrame: (row) => row.eventId,
    keysFor: (eventIds) => eventIds.filter((id) => this._frames.has(id)),
  });

  static styles = [globalStyles, inspectorGridStyles];

  willUpdate(changed: PropertyValues): void {
    if (changed.has('eventId')) {
      // The rows under the pointer go, and the grid cannot report it leaving them.
      if (this._source) {
        dispatchInspectorLocate(this, []);
      }
      const { rows, rootTotal } = buildCallStackData(this.eventId);
      this._columns = callStackColumns(rootTotal);
      this._frames = new Set(rows.map((row) => row.eventId));
      this._source = { roots: rows, key: (row) => row.eventId };
    }
  }

  updated(changed: PropertyValues): void {
    // The anchor holds when only the active frame moves, so the rows are unchanged: only the mark moves.
    if (changed.has('eventId') || changed.has('activeEventId')) {
      void this._inspector.selectActive(this.activeEventId >= 0 ? [this.activeEventId] : null);
    }
  }

  render() {
    return html`<lv-app-grid
        ${ref(this._grid)}
        .label=${'Call stack'}
        .placeholder=${'No call stack available'}
        .source=${this._source}
        .columns=${this._columns}
        .marked=${this._inspector.marked}
      ></lv-app-grid>
      ${this._inspector.menu()}`;
  }
}

function callStackColumns(rootTotal: number): GridColumn<CallStackRow>[] {
  return [
    inlineQueryColumn({
      id: 'text',
      title: 'Frame',
      value: (row) => row.text,
      dialect: (row) => queryDialect(row.type),
    }),
    // The outermost frame's total is the stack root; a sum would count the nested chain twice.
    timeColumn({
      id: 'duration.total',
      title: 'Total (ms)',
      value: (row) => row.duration.total,
      totalNs: rootTotal,
      calc: max((row) => row.duration.total),
    }),
    timeColumn({
      id: 'duration.self',
      title: 'Self (ms)',
      value: (row) => row.duration.self,
      totalNs: rootTotal,
      calc: sum((row) => row.duration.self),
    }),
  ];
}
