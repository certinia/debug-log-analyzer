/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';

import type { ApexLog } from '@apexdevtools/apex-log-parser';
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { LocatedRowIds } from '../../../components/locatedRow.js';
import { InspectorTabController } from '../../../components/InspectorTabController.js';
import { revealFirstOf } from '../../../components/inspectorTab.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { SubscriptionController } from '../../../core/events/SubscriptionController.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { logStoreFor } from '../../../core/log/LogStore.js';
import { isVisible } from '../../../core/utility/Util.js';
import {
  ColumnSettingsController,
  heldColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import { exportCsv } from '../../../components/grid/exportCsv.js';
import { LvGridFindController } from '../../../components/grid/LvGridFindController.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import { columnViewSelect, gridToolbarActions } from '../../../components/gridToolbar.js';
import type { GridColumn, GroupBy, TreeSource } from '../../../grid/index.js';
import { CALL_TREE_VIEWS } from '../../../tabulator/ColumnViews.js';
import '../../call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../call-tree/grid/CallTreeGrid.js';
import {
  BOTTOM_UP_DETAILS,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  bottomUpGroupBy,
  mergedLines,
} from '../../call-tree/grid/columns.js';
import { inspectorRowEvents } from '../../call-tree/grid/inspectorRowEvents.js';
import {
  linkRows,
  markedIds,
  mergedPath,
  mergedRow,
  rowStandIn,
  type MergedLinks,
} from '../../call-tree/grid/mergedRows.js';
import { buildBottomUpTree, type BottomUpRow } from '../../call-tree/utils/Aggregation.js';
import { wireCategoryColoring } from '../../call-tree/utils/CategoryColoring.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// Components
import '../../../components/datagrid-filter-bar.js';
import '../../../components/GridSkeleton.js';

/** The Name column is always shown in the analysis table. */
const ALWAYS_VISIBLE = ['text'];

const openType = (text: string): void => vscodeMessenger.send<string>('openType', text);

@customElement('analysis-view')
export class AnalysisView extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        gap: 1rem;
        /* inset previously provided by the tab panel's padding */
        padding: 10px 6px;
        box-sizing: border-box;
      }

      .analysis-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      #analysis-table-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }

      .filter-container {
        display: flex;
        gap: 4px;
        align-items: flex-end;
      }

      .filter-container vscode-button {
        height: var(--filter-control-height);
      }

      .filter-container vscode-button::part(base) {
        padding: var(--filter-control-padding);
        font-size: var(--filter-control-font-size);
      }
    `,
  ];

  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  private _source: TreeSource<BottomUpRow> | null = null;
  @state()
  private _columns: GridColumn<BottomUpRow>[] = [];
  @state()
  private _groupBy: GroupBy<BottomUpRow> | null = null;
  @state()
  private _marked: ReadonlySet<number> = new Set();
  @state()
  private _colorize = false;
  @state()
  private _showDetails = false;

  grid: CallTreeGrid<BottomUpRow> | null = null;
  private _links: MergedLinks<BottomUpRow> | null = null;
  private _built: Promise<void> | null = null;

  // A render binds `_columns` to the grid again, so the column view writes there, not to the grid.
  private readonly _columnTarget = heldColumnTarget<BottomUpRow>(
    () => this._columns,
    (columns) => (this._columns = columns),
  );
  private readonly _settings = new ColumnSettingsController(this, {
    section: 'callTree',
    read: (settings) => settings.callTree,
    views: CALL_TREE_VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    tables: () => [this._columnTarget],
  });
  private readonly _menus = new GridColumnMenuController({
    table: () => this._columnTarget,
    menu: () => this.renderRoot.querySelector<ContextMenu>('context-menu'),
    columns: this._settings,
  });

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _locateIds = new LocatedRowIds();
  // Its own memo: one shared with the mark would drop the picked frames on each reveal.
  private _revealIds = new LocatedRowIds();

  private readonly _finder = new LvGridFindController(this, {
    grids: () => (this.grid ? [this.grid] : []),
  });

  private readonly _subscriptions = new SubscriptionController(this, () => [
    wireCategoryColoring(this, (on) => (this._colorize = on)),
  ]);

  private readonly _inspector = new InspectorTabController(this, 'analysis', {
    // A row is a method bucket rather than one event, so a frame is translated
    // into the paths of the rows it heads.
    mark: (eventIndexes) => this._markLocated(eventIndexes),
    // An inspector finding names one event; the grid holds it in the bucket for
    // its method, so that bucket is what gets revealed.
    reveal: (eventIndex, signal) => this._revealEventIndex(eventIndex, signal),
    // The grid reports the clear itself, which is what reaches the inspector.
    clear: () => this.grid?.deselect(),
    // A row buckets calls, so a merged pick moves to the first of them.
    revealMerged: revealFirstOf((eventIndex, signal) => this._revealEventIndex(eventIndex, signal)),
  });

  /**
   * Mark the buckets that hold `eventIndexes`. The grid ranks methods and expands
   * to their callers, so one frame heads a row at every caller depth it sits in.
   */
  private _markLocated(eventIndexes: readonly number[]): void {
    const pathIds = this._locateIds.idsFor(this.timelineRoot, eventIndexes, 'callers');
    const marked = markedIds(this._links, pathIds);
    // A new set repaints the rows, and most pointer moves leave the mark as it was.
    if (marked.size !== this._marked.size || [...marked].some((id) => !this._marked.has(id))) {
      this._marked = marked;
    }
  }

  /**
   * Select the bucket holding `eventIndex` and scroll it into view. Guarded, so the
   * inspector keeps the findings it was clicked in rather than being rebuilt around
   * the row it just asked for.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    const grid = this.grid;
    const pathIds = this._revealIds.idsFor(this.timelineRoot, [eventIndex], 'callers');
    const row = mergedRow(this._links, pathIds);
    if (!grid || !row) {
      return;
    }

    // Show Details keeps only rows with a duration, so the buckets for debug
    // lines, thrown exceptions and query plans are filtered out — exactly the
    // events a finding points at. Turn the filter off rather than reveal nothing.
    if (!this._showDetails && !BOTTOM_UP_DETAILS.test(row)) {
      this._showDetails = true;
      await this.updateComplete;
    }

    if (signal.aborted) {
      return;
    }

    await this._echoGuard.runAsync(() =>
      grid.goTo(mergedPath(this._links, pathIds), { scrollIfVisible: false }),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // The inspector stops reporting on detach, so the empty mark of a pointer leaving may never come.
    this._marked = new Set();
  }

  updated(changedProperties: PropertyValues): void {
    if (
      this.timelineRoot &&
      changedProperties.has('timelineRoot') &&
      !changedProperties.get('timelineRoot')
    ) {
      this._buildWhenVisible();
    }
  }

  render() {
    return html`
      <div class="analysis-view">
        <datagrid-filter-bar>
          <div slot="table-actions" class="filter-container">
            <vscode-button
              secondary
              aria-label="Expand all"
              title="Expand all"
              @click=${() => void this._expandAll(true)}
              >Expand</vscode-button
            >
            <vscode-button
              secondary
              aria-label="Collapse all"
              title="Collapse all"
              @click=${() => void this._expandAll(false)}
              >Collapse</vscode-button
            >
          </div>

          ${columnViewSelect({
            id: 'column-view',
            views: CALL_TREE_VIEWS,
            columns: this._settings,
            menus: this._menus,
          })}

          <div slot="filters" class="filter-container">
            <button
              type="button"
              class="filter-control pill-toggle"
              aria-pressed="${this._showDetails}"
              @click="${() => (this._showDetails = !this._showDetails)}"
            >
              Details
            </button>
          </div>

          <vs-select
            dense
            slot="group"
            id="groupby-dropdown"
            prefix="Group"
            label="Group by"
            @change="${(e: Event) =>
              (this._groupBy = bottomUpGroupBy((e.target as HTMLInputElement).value))}"
          >
            <vscode-option>None</vscode-option>
            <vscode-option>Namespace</vscode-option>
            <vscode-option>Caller Namespace</vscode-option>
            <vscode-option>Type</vscode-option>
          </vs-select>

          ${gridToolbarActions({
            menus: this._menus,
            exportToCSV: () => void (this.grid && exportCsv(this.grid, 'analysis.csv')),
            copyToClipboard: () => void this.grid?.copy(),
          })}
        </datagrid-filter-bar>

        <div id="analysis-table-container">
          ${this._source ? this._renderGrid() : html`<grid-skeleton></grid-skeleton>`}
        </div>
        <context-menu
          @menu-select="${(e: CustomEvent<{ itemId: string }>) => this._menus.select(e.detail.itemId)}"
        ></context-menu>
      </div>
    `;
  }

  private _renderGrid() {
    return html`
      <lv-call-tree-grid
        ${ref(this._gridMounted)}
        ?category-colorize="${this._colorize}"
        .placeholder="${'No Analysis Available'}"
        .source="${this._source}"
        .columns="${this._columns}"
        .filters="${this._showDetails ? [] : [BOTTOM_UP_DETAILS]}"
        .sort="${BOTTOM_UP_SORT}"
        .rowLines="${mergedLines}"
        .groupBy="${this._groupBy}"
        .marked="${this._marked}"
        @lv-grid-select="${this._rowEvents.select}"
        @lv-grid-locate="${this._rowEvents.locate}"
        @lv-grid-reshape="${() => this._finder.dropOnReshape()}"
      ></lv-call-tree-grid>
    `;
  }

  private readonly _gridMounted = (el?: Element): void => {
    this.grid = (el as CallTreeGrid<BottomUpRow> | undefined) ?? null;
    if (this.grid) {
      this._menus.initGrid(this.grid);
    }
  };

  private _buildWhenVisible(): void {
    void isVisible(this).then((visible) => {
      const root = this.timelineRoot;
      if (root && visible) {
        this._built ??= this._build(root);
      }
    });
  }

  private async _build(root: ApexLog): Promise<void> {
    const roots = await buildBottomUpTree(
      root.children,
      logStoreFor(root).keyPathIds(),
      root.governorLimits,
    );
    if (!roots) {
      return;
    }
    this._links = linkRows(roots);
    this._columns = bottomUpColumns(root, { openType });
    this._settings.applyTo(this._columnTarget);
    this._source = { roots, children: (row) => row._children, key: (row) => row.id };
  }

  private async _expandAll(open: boolean): Promise<void> {
    await (open ? this.grid?.expandAll() : this.grid?.collapseAll());
    // The keys and copy act on the grid, not on the button that was clicked.
    this.grid?.focus({ preventScroll: true });
  }

  // A row ranks a method by self time and opens to its callers, so the inspector reads it as callers.
  private readonly _rowEvents = inspectorRowEvents<BottomUpRow>({
    source: 'analysis',
    root: () => this.timelineRoot,
    view: () => 'callers',
    standIn: (row) =>
      rowStandIn(
        row,
        (r) => r,
        (r) => this._links?.parents.get(r),
      ),
    echoGuard: this._echoGuard,
    dropPick: () => this._inspector.dropPick(),
  });
}
