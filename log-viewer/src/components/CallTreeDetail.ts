/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import './GridSkeleton.js';
import './ViewModeSwitch.js';
import './grid/AppGrid.js';
import { consume } from '@lit/context';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import type { DetailSource, SelectionView } from '#core/events/EventBus.js';
import { TeardownController } from '#core/events/TeardownController.js';
import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';
import { RangeScopeController, sameWindow, type TimeWindow } from '#core/log/rangeScope.js';
import { waitForNextFrame, type FrameBudgetOptions } from '#core/utility/FrameBudget.js';
import { queryDialect } from '../features/call-tree/grid/cells.js';
import { eventLabel } from '../features/call-tree/utils/eventText.js';
import {
  sum,
  type Calc,
  type GridColumn,
  type GridSort,
  type RowFilter,
  type TreeSource,
} from '../grid/index.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from './grid/measureWidth.js';
import {
  VIEW_MODES,
  callTreeLabel,
  defaultViewMode,
  isViewMode,
  type ViewMode,
} from './callTreeViewModes.js';
import type { AppGrid } from './grid/AppGrid.js';
import { countColumn, inlineQueryColumn, timeColumn } from './grid/columns.js';
import {
  InspectorGridController,
  inspectorGridStyles,
  NOTHING_MARKED,
} from './grid/InspectorGridController.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from './inspectorReveal.js';
import { LocatedRowIds } from './locatedRow.js';
import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  frameEventIndexes,
  locatableEventIndexes,
  revealableEventIndex,
  rowIdsByPath,
  type LiveWindow,
  type ScopedCallTree,
  type ScopedRow,
} from './scopedCallTree.js';

/**
 * The mode picked per source tab, shared by every instance: the pane is torn
 * down and rebuilt on each collapse, tab hop and panel toggle, so without this
 * the pick would reset on every selection. Absent until the user picks, so the
 * default applies until then. Keyed by the log, so a pick is something you made
 * in this log and dies with it — never persisted, never carried to the next.
 */
const pickedViewMode = new WeakMap<LogStore, Map<DetailSource | undefined, ViewMode>>();

/** The picks made in one log, created on the first pick. */
function picksFor(store: LogStore): Map<DetailSource | undefined, ViewMode> {
  let picks = pickedViewMode.get(store);
  if (!picks) {
    picks = new Map();
    pickedViewMode.set(store, picks);
  }
  return picks;
}

const MODES = VIEW_MODES.map((option) => option.value);

// Time Order stays chronological, which is what the mode is for. The grouped modes lead with their ranking metric.
const MODE_SORT: Record<ViewMode, GridSort | null> = {
  'time-order': null,
  aggregated: { column: 'duration.total', dir: 'desc' },
  'bottom-up': { column: 'duration.self', dir: 'desc' },
};

// Open the callers above the selection so it is on screen, and leave what ran inside it closed.
const onPath = (row: ScopedRow): boolean => row.onPath === true;

interface GridSlot {
  source: TreeSource<ScopedRow>;
  columns: GridColumn<ScopedRow>[];
  // Empty until the rows are read ahead: till then the window filter would keep every row.
  filters: RowFilter<ScopedRow>[];
  admit: RowFilter<ScopedRow>;
  // Built on the first mark of a fill: only a pointer in the tab's own view needs it.
  rowsByPath: Map<number, number> | null;
  // Needs filling for the new scope before it is shown again.
  stale: boolean;
  readAt: TimeWindow | null;
  // True once the rows can follow a window without reading ahead first.
  prepared: boolean;
  preparing: AbortController | null;
}

/**
 * The scoped call tree for the selected statement, switchable between Time Order
 * / Aggregated / Bottom-Up (Chrome-perf style), with a compact Name / Total /
 * Self (+ Calls) column set. Grids fill lazily per mode, and fill again when the
 * selection changes.
 */
@customElement('call-tree-detail')
export class CallTreeDetail extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  /** Occurrence eventIndexes when the selection is an aggregate row; the tree
   *  then scopes to every occurrence, aggregated. */
  @property({ attribute: false })
  instances: number[] | null = null;

  /** The frame the user walked to inside the scope. It only moves the mark: the
   *  scope is anchored on `eventIndex`, so the trees are never rebuilt for it. */
  @property({ type: Number })
  activeEventIndex = -1;

  /** True shows the whole log rooted at the log itself — real durations,
   *  nothing scoped or attributed. `eventIndex`/`instances` are then ignored. */
  @property({ type: Boolean })
  wholeLog = false;

  /** The tab the selection came from, so a pick is remembered per tab. Absent on
   *  the whole-log tree, which no tab selected. */
  @property({ attribute: false })
  source?: DetailSource;

  /** The direction that tab is showing, where it shows a tree at all. */
  @property({ attribute: false })
  sourceView?: SelectionView;

  // The log on screen, from the app root.
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  @state()
  private viewMode: ViewMode = 'time-order';

  @state()
  private _pending = false;

  private _slots: Record<ViewMode, GridSlot | null> = {
    'time-order': null,
    aggregated: null,
    'bottom-up': null,
  };

  private readonly _grids: Record<ViewMode, Ref<AppGrid<ScopedRow>>> = {
    'time-order': createRef(),
    aggregated: createRef(),
    'bottom-up': createRef(),
  };

  // The bars' denominator and the Total footer, in ns.
  private _rootTotal = 0;
  private _scopeCalls = 0;
  // Set while the whole-log tree follows a window: summing the rows would read every one into it.
  private _scopeSelf: number | null = null;
  private _scopeFrameSelf: number | null = null;

  // The scoped tree (all three representations) for the current eventIndex,
  // computed once per selection and shared across the mode grids.
  private _scoped: ScopedCallTree | null = null;

  // The whole-log tree follows the Timeline's window every frame; a selection's tree never does.
  private readonly _range = new RangeScopeController(this, () => this.wholeLog);
  private _live: LiveWindow | null = null;

  // The build in flight; a newer view-switch aborts it, and so does a teardown.
  private _switch: AbortController | null = null;

  // The tab re-reports the same list every time the pointer leaves a row.
  private _locateIds = new LocatedRowIds();
  // The last report and the frames of it this scope stands for, so the filter
  // runs once per report rather than once per pointer move.
  private _reported: readonly number[] = [];
  private _reportedInScope: readonly number[] = [];

  private readonly _inspector = new InspectorGridController<ScopedRow>(this, {
    grid: () => this._grids[this.viewMode].value ?? null,
    source: () => this._slots[this.viewMode]?.source,
    frames: frameEventIndexes,
    pick: (row) => this._pick(row),
    // A merged row's `eventIndex` is its first occurrence, so the action lands there.
    menuFrame: (row) => row.eventIndex,
    keysFor: (eventIndexes) => this._rowIdsFor(this.viewMode, eventIndexes),
    dropOnClear: true,
  });

  private readonly _teardown = new TeardownController(this, {
    teardown: () => {
      this._switch?.abort();
      this._abortPrepares();
      // The grids let go of their rows; the scoped tree stays, so a rebuild needs no walk.
      this._slots = { 'time-order': null, aggregated: null, 'bottom-up': null };
      this.requestUpdate();
    },
    rebuild: () => void this._showActive(),
  });

  static styles = [
    globalStyles,
    inspectorGridStyles,
    css`
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lana-space-sm);
        padding-bottom: var(--lana-space-2xs);
        flex: 0 0 auto;
      }
      .grids {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
      }
      lv-app-grid {
        position: absolute;
        inset: 0;
      }
      lv-app-grid.is-hidden {
        display: none;
      }
    `,
  ];

  willUpdate() {
    // Idempotent: a pick is written to the map before the mode is set, so
    // recomputing it here always lands on the same answer.
    const picked = this.logStore && pickedViewMode.get(this.logStore)?.get(this.source);
    this.viewMode = picked || defaultViewMode(this.sourceView, !!this.instances?.length);
  }

  updated(changed: PropertyValues) {
    // Only the whole-log tree can mount before a parse, so there a new log is a new scope.
    const scopeChanged =
      (changed.has('logStore') && this.wholeLog) ||
      changed.has('eventIndex') ||
      changed.has('instances');
    if (scopeChanged) {
      this._invalidateScope();
    }
    if (scopeChanged || changed.has('viewMode')) {
      void this._showActive();
      return;
    }
    if (changed.has('activeEventIndex')) {
      // The anchor holds, so the rows are unchanged — only the mark moves.
      this._selectActive();
    }
    if (this._live && !sameWindow(this._range.window, this._slots[this.viewMode]?.readAt ?? null)) {
      this._followWindow();
    }
  }

  render() {
    return html`
      <div class="toolbar">
        <view-mode-switch
          aria-label="Call tree view mode"
          .options=${VIEW_MODES}
          value=${this.viewMode}
          @view-mode-change=${(e: CustomEvent<{ value: string }>) =>
            this._setViewMode(e.detail.value)}
        ></view-mode-switch>
      </div>
      <div class="grids">
        ${this.logStore ? '' : html`<grid-skeleton></grid-skeleton>`}
        ${MODES.map((mode) => this._renderGrid(mode))}
      </div>
      ${this._inspector.menu()}
    `;
  }

  private _renderGrid(mode: ViewMode) {
    const slot = this._slots[mode];
    const shown = mode === this.viewMode;
    return html`<lv-app-grid
      class=${shown ? '' : 'is-hidden'}
      ${ref(this._grids[mode])}
      .label=${callTreeLabel(mode)}
      .placeholder=${this._pending ? 'Building the call tree…' : 'No call tree available'}
      .source=${slot?.source ?? null}
      .columns=${slot?.columns ?? []}
      .filters=${slot?.filters ?? []}
      .sort=${MODE_SORT[mode]}
      .expanded=${onPath}
      .marked=${shown ? this._inspector.marked : NOTHING_MARKED}
      @lv-grid-expand=${() => this._prepareWaiting(mode)}
    ></lv-app-grid>`;
  }

  // A merged row would misname which occurrence was clicked, so its pick holds a mark on every
  // frame it stands for, as the Chrome DevTools performance panel keeps a picked group's frames lit.
  private _pick(row: ScopedRow | null): void {
    const eventIndex = revealableEventIndex(row ?? undefined);
    if (eventIndex !== null) {
      dispatchInspectorReveal(this, eventIndex);
      return;
    }
    // The same aggregate a merged row in the tab itself reports, so Details
    // reads the same either way. Built from the row: a scoped row carries no
    // key, which is what the tab's own rows are read through.
    const frames = frameEventIndexes(row ?? undefined);
    // A top-level bottom-up row names its own calls; a caller row was reached through its own frame.
    const isCaller =
      this.viewMode === 'bottom-up' &&
      !!row &&
      !this._slots['bottom-up']?.source.roots.includes(row);
    dispatchInspectorLocate(this, frames, true, {
      kind: 'aggregate',
      instances: locatableEventIndexes(row ?? undefined),
      frames,
      calledBy: isCaller ? row.text : undefined,
    });
    if (!row) {
      // A click on the selected row clears it, but the active frame is still the active one.
      this._selectActive();
    }
  }

  /**
   * The ids of the rows that name `eventIndexes` in `mode`. Time Order keys its
   * rows by event, so there the ids are the indexes themselves — unless it merged
   * a selection's occurrences, when its rows are grouped like the other views'. A
   * grouped row merges occurrences behind a synthetic id, so it is found by the
   * bucket path it stands for.
   */
  private _rowIdsFor(mode: ViewMode, eventIndexes: readonly number[]): readonly number[] {
    if (mode === 'time-order' && !this._scoped?.timeOrderMerged) {
      return this._inScope(eventIndexes);
    }
    const slot = this._slots[mode];
    if (!slot || slot.stale || !slot.source.roots.length) {
      // Still building. Caching the map now would hold an empty one for the life
      // of the scope, since only a new scope clears it.
      return [];
    }
    const byPath = (slot.rowsByPath ??= rowIdsByPath(slot.source.roots));
    const pathIds = this._locateIds.idsFor(
      this.logStore,
      this._inScope(eventIndexes),
      mode === 'bottom-up' ? 'callers' : 'callees',
    );
    return pathIds.flatMap((pathId) => byPath.get(pathId) ?? []);
  }

  /**
   * The reported frames this scope stands for. A merged row is named by its
   * bucket path, so without this a frame at the same path elsewhere in the log
   * would mark a row that holds a different call.
   */
  private _inScope(eventIndexes: readonly number[]): readonly number[] {
    const holds = this._scoped?.holds;
    if (!holds) {
      return eventIndexes;
    }
    if (this._reported !== eventIndexes) {
      this._reported = eventIndexes;
      this._reportedInScope = eventIndexes.filter(holds);
    }
    return this._reportedInScope;
  }

  // The rows stay put, so the selection and the marks hold.
  private _followWindow(): void {
    const slot = this._slots[this.viewMode];
    const live = this._live;
    if (!live || !slot || slot.stale) {
      return;
    }
    if (!slot.prepared) {
      if (this._range.window) {
        void this._prepare(slot);
      }
      // Rows never read into a window still hold the whole log's figures.
      this._showFigures(live.figures(null));
      return;
    }
    slot.readAt = this._range.window;
    this._showFigures(live.set(slot.readAt));
    const mode = this.viewMode;
    void this._grids[mode].value?.refresh().then(() => this._prepareWaiting(mode));
  }

  private _showFigures({
    rootTotal,
    calls,
    self,
    frameSelf,
  }: ReturnType<LiveWindow['figures']>): void {
    this._rootTotal = rootTotal;
    this._scopeCalls = calls;
    this._scopeSelf = self;
    this._scopeFrameSelf = frameSelf;
  }

  // Rows of many calls opened since the read-ahead; they follow the window once read.
  private _prepareWaiting(mode: ViewMode): void {
    const slot = this._slots[mode];
    // The read-ahead in flight refilters when it lands, which lists them again.
    if (!slot || slot.preparing) {
      return;
    }
    const rows = this._live?.waiting() ?? [];
    if (rows.length) {
      void this._prepare(slot, rows);
    }
  }

  private async _prepare(
    slot: GridSlot,
    rows: readonly ScopedRow[] = slot.source.roots,
  ): Promise<void> {
    const live = this._live;
    if (!live || slot.preparing) {
      return;
    }
    const preparing = new AbortController();
    slot.preparing = preparing;
    const ready = await live.prepare(rows, { signal: preparing.signal });
    // A new log, a refill or a disconnect aborts it.
    if (!ready || preparing.signal.aborted) {
      return;
    }
    slot.preparing = null;
    slot.prepared = true;
    // A new filter object refilters every row, and the refresh below already does.
    if (!slot.filters.length) {
      slot.filters = [slot.admit];
      this.requestUpdate();
    }
    this._followWindow();
  }

  /**
   * Selects the active frame, without reporting it as a new pick. Only rows keyed
   * by event can be selected by index, so a view whose rows merge occurrences
   * keeps the row the user picked: clearing it would take away the row the
   * keyboard moves from.
   */
  private _selectActive(): void {
    const slot = this._slots['time-order'];
    if (!slot || this.viewMode !== 'time-order' || this._scoped?.timeOrderMerged) {
      return;
    }
    const path =
      this.activeEventIndex >= 0
        ? this._timeOrderPath(slot.source.roots, this.activeEventIndex)
        : null;
    void this._inspector.selectActive(path);
  }

  /** The keys from a top-level row down to `eventIndex`, or null where the rows do not hold it. */
  private _timeOrderPath(roots: readonly ScopedRow[], eventIndex: number): number[] | null {
    const lineage = (this.logStore?.stackByEventIndex(eventIndex) ?? []).map((e) => e.id);
    if (lineage.at(-1) !== eventIndex) {
      lineage.push(eventIndex);
    }
    const path: number[] = [];
    let list = roots;
    for (const id of lineage) {
      const row = list.find((r) => r.id === id);
      if (row) {
        path.push(id);
        list = row._children ?? [];
      }
    }
    return path.at(-1) === eventIndex ? path : null;
  }

  /**
   * The scoped root changed: every grid lets go of its rows, which describe the old scope,
   * and fills again when shown. `_scoped` is only rebuilt in `_showActive`, past its paint yield.
   */
  private _invalidateScope(): void {
    this._scoped = null;
    this._live = null;
    this._abortPrepares();
    for (const slot of Object.values(this._slots)) {
      if (slot) {
        slot.stale = true;
        slot.source = { ...slot.source, roots: [] };
        slot.rowsByPath = null;
      }
    }
    this.requestUpdate();
  }

  private _abortPrepares(): void {
    for (const slot of Object.values(this._slots)) {
      if (slot) {
        slot.preparing?.abort();
        slot.preparing = null;
      }
    }
  }

  /**
   * The rows for `mode`, building (and caching) the scoped tree first if this is
   * the selection's first view. Returns an empty array when nothing is in scope,
   * and null when the build was abandoned because a newer selection arrived.
   */
  private async _rows(mode: ViewMode, options: FrameBudgetOptions): Promise<ScopedRow[] | null> {
    if (!this._scoped) {
      const scoped = this.wholeLog
        ? await buildWholeLogCallTree(options)
        : await buildScopedCallTree(this.eventIndex, this.instances, options);
      if (options.signal?.aborted) {
        // Abandoned rather than empty — don't cache the null over a scope that
        // was never walked.
        return null;
      }
      this._scoped = scoped;
      this._live = scoped?.liveWindow?.() ?? null;
    }
    const scoped = this._scoped;
    if (!scoped) {
      return [];
    }
    switch (mode) {
      case 'time-order':
        return scoped.timeOrder(options);
      case 'aggregated':
        return scoped.aggregated(options);
      case 'bottom-up':
        return scoped.bottomUp(options);
    }
  }

  private async _showActive(): Promise<void> {
    // A newer switch, or a teardown, aborts this one.
    this._switch?.abort();
    const { signal } = (this._switch = new AbortController());
    // So the selection highlight and the rest of the panel paint before the walk
    // starts; the walk then slices itself, so it never blocks a frame either.
    await this.updateComplete;
    await waitForNextFrame();
    if (signal.aborted) {
      return;
    }

    const mode = this.viewMode;
    const built = this._slots[mode];
    if (built && !built.stale) {
      // The footer and bar figures are shared, and a read-ahead may have landed while it was hidden.
      this._followWindow();
      // The active frame may have moved while another view was on screen.
      this._selectActive();
      return;
    }

    this._pending = true;
    const data = await this._rows(mode, { signal });
    if (!data || signal.aborted) {
      return;
    }
    this._pending = false;
    const scoped = this._scoped;
    if (!built && !scoped) {
      // Nothing in scope, so there is nothing to size a new grid against.
      return;
    }
    this._showFigures({
      rootTotal: scoped?.rootTotal ?? 0,
      calls: scoped?.calls ?? 0,
      self: null,
      frameSelf: null,
    });

    const slot = built ?? this._newSlot(mode, scoped?.logTotal ?? 0);
    slot.stale = false;
    slot.readAt = null;
    slot.prepared = false;
    slot.filters = [];
    slot.rowsByPath = null;
    slot.source = { roots: data, children: (row) => row._children, key: (row) => row.id };
    this._slots[mode] = slot;
    this.requestUpdate();
    this._followWindow();
    await this.updateComplete;
    this._selectActive();
  }

  private _newSlot(mode: ViewMode, logTotal: number): GridSlot {
    return {
      source: { roots: [], key: (row) => row.id },
      // Sized from the whole log rather than the selection, so the bar columns keep one width as the selection changes.
      columns: this._columns(mode, progressColumnWidth(logTotal)),
      filters: [],
      // Admit writes the figures that the sort and footer read; the grid filters before both.
      admit: { test: (row) => this._live?.admit(row) ?? true },
      rowsByPath: null,
      stale: false,
      readAt: null,
      prepared: false,
      preparing: null,
    };
  }

  private _columns(mode: ViewMode, width: number): GridColumn<ScopedRow>[] {
    const totalNs = () => this._rootTotal;
    const scopeSelf = () => (mode === 'bottom-up' ? this._scopeFrameSelf : this._scopeSelf);
    const allSelf = sum<ScopedRow>((row) => row.duration.self, 'all');
    const self: Calc<ScopedRow> = {
      // Read on each run: once the window knows the self time, a sum of every row would read each one into it.
      get scope() {
        return scopeSelf() === null ? 'all' : 'top';
      },
      of: (rows) => scopeSelf() ?? allSelf.of(rows),
    };
    const columns = [
      {
        ...inlineQueryColumn<ScopedRow>({
          id: 'text',
          title: 'Name',
          value: (row) => {
            const event = queryDialect(row.type) ? null : this.logStore?.log.event(row.eventIndex);
            return event ? eventLabel(event) : row.text;
          },
          dialect: ({ type }) => queryDialect(type),
        }),
        // The raw text, as the Call Tree sorts: a label is built on each compare.
        sort: { value: (row: ScopedRow) => row.text },
      },
      // The grid sums the top level only, which is the whole scope in the grouped
      // modes and overlapping rows in Bottom-Up. The scope's own total answers in every mode.
      timeColumn<ScopedRow>({
        id: 'duration.total',
        title: 'Total (ms)',
        value: (row) => row.duration.total,
        totalNs,
        calc: { of: totalNs },
        width,
      }),
      timeColumn<ScopedRow>({
        id: 'duration.self',
        title: 'Self (ms)',
        value: (row) => row.duration.self,
        totalNs,
        calc: self,
        width,
      }),
    ];
    // Time Order rows are single calls, so a count only makes sense once frames are grouped.
    if (mode !== 'time-order') {
      // Aggregated counts a call at its own depth and Bottom-Up counts it in
      // its leaf row, so neither top level holds them all. The scope does.
      columns.push({
        ...countColumn<ScopedRow>({
          id: 'callCount',
          title: 'Calls',
          value: (row) => row.callCount,
        }),
        calc: { of: () => this._scopeCalls },
      });
    }
    return columns;
  }

  private _setViewMode(mode: string) {
    if (!isViewMode(mode)) {
      return;
    }
    if (this.logStore) {
      picksFor(this.logStore).set(this.source, mode);
    }
    this.viewMode = mode;
  }
}
