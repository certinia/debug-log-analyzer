/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { consume } from '@lit/context';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { logContext } from '../../../core/log/logContext.js';
import type { LogStore } from '../../../core/log/LogStore.js';

import type { ApexLog } from '@apexdevtools/apex-log-parser';
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { LocatedRowIds } from '../../../components/locatedRow.js';
import { InspectorTabController } from '../../../components/InspectorTabController.js';
import { revealFirstOf } from '../../../components/inspectorTab.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { SubscriptionController } from '../../../core/events/SubscriptionController.js';
import { isVisible, setChanged } from '../../../core/utility/Util.js';
import {
  ColumnSettingsController,
  heldColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import { exportCsv } from '../../../components/grid/exportCsv.js';
import { FindController } from '../../find/FindController.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import {
  columnViewSelect,
  gridGroupControls,
  gridToolbarActions,
} from '../../../components/gridToolbar.js';
import type { GridColumn, GroupBy, RowKey, TreeSource } from '../../../grid/index.js';
import { CALL_TREE_VIEWS } from '../../../components/grid/ColumnViews.js';
import '../../call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../call-tree/grid/CallTreeGrid.js';
import {
  BOTTOM_UP_DETAILS,
  BOTTOM_UP_GROUPS,
  BOTTOM_UP_SORT,
  CALL_TREE_COLUMN_SETTINGS,
  bottomUpColumns,
  bottomUpGroupBy,
  mergedLines,
  openType,
} from '../../call-tree/grid/columns.js';
import { inspectorRowEvents } from '../../call-tree/grid/inspectorRowEvents.js';
import { MergedTree } from '../../call-tree/grid/mergedRows.js';
import type { BottomUpRow } from '../../call-tree/utils/Aggregation.js';
import { wireCategoryColoring } from '../../call-tree/utils/CategoryColoring.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// Components
import '../../../components/datagrid-filter-bar.js';
import '../../../components/GridSkeleton.js';

@customElement('analysis-view')
export class AnalysisView extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        /* inset previously provided by the tab panel's padding */
        padding: var(--lana-space-md) var(--lana-space-xs);
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
        gap: var(--lana-space-2xs);
        align-items: flex-end;
      }
    `,
  ];

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  private get timelineRoot(): ApexLog | null {
    return this.logStore?.log ?? null;
  }

  @state()
  private _source: TreeSource<BottomUpRow> | null = null;
  @state()
  private _columns: GridColumn<BottomUpRow>[] = [];
  @state()
  private _groupBy: GroupBy<BottomUpRow> | null = null;
  @state({ hasChanged: setChanged })
  private _marked: ReadonlySet<RowKey> = new Set();
  @state()
  private _colorize = false;
  @state()
  private _showDetails = false;

  // State, so the expand button follows the grid once it mounts.
  @state()
  grid: CallTreeGrid<BottomUpRow> | null = null;
  private _tree: MergedTree<BottomUpRow> | null = null;
  private _built: Promise<void> | null = null;
  private _builds = new AbortController();

  // A render binds `_columns` to the grid again, so the column view writes there, not to the grid.
  private readonly _columnTarget = heldColumnTarget<BottomUpRow>(
    () => this._columns,
    (columns) => (this._columns = columns),
  );
  private readonly _settings = new ColumnSettingsController(this, {
    ...CALL_TREE_COLUMN_SETTINGS,
    targets: () => [this._columnTarget],
  });
  private readonly _menus = new GridColumnMenuController({
    target: this._columnTarget,
    menu: () => this.renderRoot.querySelector<ContextMenu>('context-menu'),
    columns: this._settings,
  });

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _locateIds = new LocatedRowIds();
  // Its own memo: one shared with the mark would drop the picked frames on each reveal.
  private _revealIds = new LocatedRowIds();

  private readonly _finder = new FindController(this, {
    targets: () => (this.grid ? [this.grid] : []),
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
    this._marked = this._tree?.marked(pathIds) ?? new Set();
  }

  /**
   * Select the bucket holding `eventIndex` and scroll it into view. Guarded, so the
   * inspector keeps the findings it was clicked in rather than being rebuilt around
   * the row it just asked for.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    const { grid, _tree: tree } = this;
    const pathIds = this._revealIds.idsFor(this.timelineRoot, [eventIndex], 'callers');
    const row = tree?.rowFor(pathIds);
    if (!grid || !tree || !row) {
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
      grid.goTo(tree.pathTo(pathIds), { scrollIfVisible: false }),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // The inspector stops reporting on detach, so the empty mark of a pointer leaving may never come.
    this._marked = new Set();
  }

  updated(changedProperties: PropertyValues): void {
    if (!this.timelineRoot || !changedProperties.has('logStore')) {
      return;
    }
    if (!changedProperties.get('logStore')) {
      this._buildWhenVisible();
    } else if (this._built) {
      // The grid keeps its sort, widths, group and filters. Its selection and mark named rows of the old log.
      this._marked = new Set();
      this.grid?.deselect();
      this._builds.abort();
      this._builds = new AbortController();
      this._built = this._build(this.timelineRoot);
    }
  }

  render() {
    return html`
      <div class="analysis-view">
        <datagrid-filter-bar>
          ${columnViewSelect({
            id: 'column-view',
            views: CALL_TREE_VIEWS,
            columns: this._settings,
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

          ${gridGroupControls({
            grid: this.grid,
            group: {
              id: 'groupby-dropdown',
              labels: BOTTOM_UP_GROUPS.map(({ label }) => label),
              onChange: (label: string) => (this._groupBy = bottomUpGroupBy(label)),
            },
          })}
          ${gridToolbarActions({
            openColumns: this._menus.open,
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
        .label="${'Analysis'}"
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
        @lv-grid-reshape="${() => void this._finder.rerun()}"
        @lv-grid-header-context="${this._menus.headerContext}"
      ></lv-call-tree-grid>
    `;
  }

  private readonly _gridMounted = (el?: Element): void => {
    this.grid = (el as CallTreeGrid<BottomUpRow> | undefined) ?? null;
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
    const tree = await MergedTree.bottomUp(root, { signal: this._builds.signal });
    if (!tree) {
      return;
    }
    this._tree = tree;
    this._columns = bottomUpColumns(root, { openType });
    this._settings.applyTo(this._columnTarget);
    this._source = tree.source;
  }

  // A row ranks a method by self time and opens to its callers, so the inspector reads it as callers.
  private readonly _rowEvents = inspectorRowEvents<BottomUpRow>({
    source: 'analysis',
    root: () => this.timelineRoot,
    view: () => 'callers',
    data: (row) => row,
    parentOf: (row) => this._tree?.parentOf(row),
    echoGuard: this._echoGuard,
    dropPick: () => this._inspector.dropPick(),
  });
}
