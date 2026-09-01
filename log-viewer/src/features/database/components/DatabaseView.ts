/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  ApexLog,
  DMLBeginLine,
  Limits,
  SOQLExecuteBeginLine,
  SOSLExecuteBeginLine,
} from 'apex-log-parser';

import { limitTotals } from '../../../components/logOverviewMetrics.js';
import { eventBus, type StatementType } from '../../../core/events/EventBus.js';
import { apexLimitTimeSeries } from '../../timeline/optimised/apex-limit-series.js';
import { InspectorEmphasis } from '../../../components/inspectorEmphasis.js';
import { wireInspectorTab } from '../../../components/inspectorTab.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { isVisible } from '../../../core/utility/Util.js';
import { soslRowsMetric } from '../limits.js';
import { logStoreFor } from '../../../core/log/LogStore.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

import type { DMLView } from './DMLView.js';
import type { SOQLView } from './SOQLView.js';
import type { SOSLView } from './SOSLView.js';

// web components
import './DMLView.js';
import './DatabaseSection.js';
import type { DatabaseMetric } from './DatabaseMetricCard.js';
import type { GridLocateEvent } from './gridLocate.js';
import type { GridSelectionEvent } from './gridSelection.js';
import './GovernorSummary.js';
import type { GaugeMetric } from './GovernorSummary.js';
import './SOQLView.js';
import './SOSLView.js';

/** A section is one statement type, so the two names are the same set. */
type SectionKind = StatementType;

/** The three grids this view drives share a selection contract. */
type DatabaseGrid = DMLView | SOQLView | SOSLView;

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  private dmlLines: DMLBeginLine[] = [];
  @state()
  private soqlLines: SOQLExecuteBeginLine[] = [];
  @state()
  private soslLines: SOSLExecuteBeginLine[] = [];
  @state()
  private loaded = false;

  /** Per-section collapsed state; empty types default to collapsed once loaded. */
  @state()
  private collapsed: Record<SectionKind, boolean> = { dml: false, soql: false, sosl: false };

  // Match totals per table, routing the shared find widget's current match to the
  // right table, accumulated in view order: DML, then SOQL, then SOSL.
  dmlMatches = 0;
  soqlMatches = 0;
  soslMatches = 0;

  @state()
  dmlHighlightIndex = 0;
  @state()
  soqlHighlightIndex = 0;
  @state()
  soslHighlightIndex = 0;

  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap = {};

  private _offInspector: (() => void) | null = null;

  /** Guards the selects this view makes on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  /** Which of the inspector's reports the grids' mark follows. */
  private _emphasis = new InspectorEmphasis();

  constructor() {
    super();

    document.addEventListener('db-find-results', this._findResults as EventListener);
    document.addEventListener('lv-find-match', this._findHandler as EventListener);
    document.addEventListener('lv-find', this._findHandler as EventListener);

    this._offInspector = wireInspectorTab('database', this._emphasis, {
      mark: (eventIndexes) => this._markLocated(eventIndexes),
      // The eventIndex belongs to exactly one grid, so each is offered it in turn
      // until one owns it.
      reveal: (eventIndex) => {
        const views = this._views;
        this._echoGuard.run(() => {
          const owner = views.find((view) => view?.selectByEventIndex(eventIndex));
          if (owner) {
            views.filter((view) => view !== owner).forEach((view) => view?.deselectRows());
          }
        });
      },
      clear: () => {
        // Only one grid holds the selection, and its report of the clear reaches
        // the inspector the same way a click does.
        this._views.forEach((view) => view?.deselectRows());
      },
    });
  }

  /** Offers the mark to every grid, since one of them owns the statement. */
  private _markLocated(eventIndexes: readonly number[]): void {
    this._views.forEach((view) => view?.markLocated(eventIndexes));
  }

  /**
   * The database tab's only `detail:select` emitter. The three grids report
   * their selection here; only one of them holds it at a time, so the two the
   * pick did not land in are cleared under the guard — otherwise their nulls
   * would arrive after the pick and undo it.
   */
  private _onGridSelection(event: GridSelectionEvent): void {
    if (this._echoGuard.suppressed) {
      return;
    }
    const { type, eventIndex } = event.detail;
    if (eventIndex === null) {
      // A mark a picked inspector row left here goes with the selection: it was
      // never a selection of these grids.
      this._markLocated(this._emphasis.pick([]));
      eventBus.emit('detail:select', { source: 'database', selection: null });
      return;
    }
    this._echoGuard.run(() => {
      for (const [kind, view] of this._gridsByKind) {
        if (kind !== type) {
          view?.deselectRows();
        }
      }
    });
    eventBus.emit('detail:select', {
      source: 'database',
      selection: { kind: 'event', eventIndex, type },
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('db-find-results', this._findResults as EventListener);
    document.removeEventListener('lv-find-match', this._findHandler as EventListener);
    document.removeEventListener('lv-find', this._findHandler as EventListener);
    this._offInspector?.();
    this._offInspector = null;
  }

  firstUpdated(): void {
    // One listener for all three grids: their reports bubble to this shadow
    // root and stop there, so grids added later are heard without rebinding.
    this.renderRoot.addEventListener('grid-selection', (event) =>
      this._onGridSelection(event as GridSelectionEvent),
    );
    // The same for the pointer, which marks rather than picks.
    this.renderRoot.addEventListener('grid-locate', (event) =>
      eventBus.emit('detail:locate', {
        source: 'database',
        eventIndexes: (event as GridLocateEvent).detail.eventIndexes,
      }),
    );
  }

  updated(changed: PropertyValues): void {
    if (this.timelineRoot && changed.has('timelineRoot') && !this.loaded) {
      void this._loadData();
    }
  }

  /** The shared whole-log totals, so a figure here matches every other surface. */
  private _limits: Limits | undefined;

  private async _loadData(): Promise<void> {
    const root = this.timelineRoot;
    if (!root) {
      return;
    }
    const visible = await isVisible(this);
    if (!visible || this.loaded) {
      return;
    }
    const store = logStoreFor(root);
    this.dmlLines = store.dmlLines();
    this.soqlLines = store.soqlLines();
    this.soslLines = store.soslLines();
    // A full pass over every event: too costly to run from render().
    this._limits = limitTotals(apexLimitTimeSeries(root));
    this.loaded = true;
    // Collapse types the transaction never touched (usually SOSL).
    this.collapsed = {
      dml: this._isEmpty('dml'),
      soql: this._isEmpty('soql'),
      sosl: this._isEmpty('sosl'),
    };
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        height: 100%;
        width: 100%;
        background-color: var(--lana-editor-bg);
      }

      .db-grids {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: auto;
        /* the inset the tab panel used to provide — kept off the docked panel */
        padding: 10px 6px;
        box-sizing: border-box;
      }

      governor-summary {
        border-bottom: var(--lana-stroke) solid var(--lana-surface-border);
        /* Left inset matches the sections' content edge. */
        padding: var(--lana-space-sm) var(--lana-space-md) var(--lana-space-md)
          var(--lana-section-inset);
      }

      .db-panel {
        display: flex;
        flex-direction: column;
      }

      /* The accent bar lives on the section header (inherits --accent); the grid
         view is inset to the same 15px content edge (3px bar + 12px header pad)
         so header, toolbar and table line up on one left edge. */
      .db-panel--dml {
        --accent: var(--vscode-charts-blue, #4e94ce);
      }
      .db-panel--soql {
        --accent: var(--vscode-charts-purple, #b180d7);
      }
      .db-panel--sosl {
        --accent: var(--vscode-charts-orange, #d18616);
      }

      .db-panel dml-view,
      .db-panel soql-view,
      .db-panel sosl-view {
        box-sizing: border-box;
        padding-left: 15px;
      }

      .db-panel + .db-panel {
        margin-top: 16px;
        border-top: 1px solid var(--lana-surface-border);
        padding-top: 8px;
      }
    `,
  ];

  render() {
    return html`
      <div class="db-grids">
        <governor-summary .metrics="${this._stripMetrics()}"></governor-summary>
        ${this._renderSection('dml')} ${this._renderSection('soql')} ${this._renderSection('sosl')}
      </div>
    `;
  }

  private get _dmlView(): DMLView | null {
    return this.renderRoot?.querySelector('dml-view') ?? null;
  }

  private get _soqlView(): SOQLView | null {
    return this.renderRoot?.querySelector('soql-view') ?? null;
  }

  private get _soslView(): SOSLView | null {
    return this.renderRoot?.querySelector('sosl-view') ?? null;
  }

  /** The three grids in view order, each with the statement type it holds. */
  private get _gridsByKind(): ReadonlyArray<readonly [SectionKind, DatabaseGrid | null]> {
    return [
      ['dml', this._dmlView],
      ['soql', this._soqlView],
      ['sosl', this._soslView],
    ];
  }

  private get _views(): ReadonlyArray<DatabaseGrid | null> {
    return this._gridsByKind.map(([, view]) => view);
  }

  private _renderSection(kind: SectionKind) {
    const collapsed = this.collapsed[kind];
    return html`<div class="db-panel db-panel--${kind}">
      <database-section
        title="${SECTION_META[kind].title}"
        ?collapsed="${collapsed}"
        .metrics="${this._sectionMetrics(kind)}"
        @section-toggle="${() => this._toggle(kind)}"
      ></database-section>
      ${collapsed || !this.loaded ? nothing : this._renderTable(kind)}
    </div>`;
  }

  private _renderTable(kind: SectionKind) {
    switch (kind) {
      case 'dml':
        return html`<dml-view
          .timelineRoot="${this.timelineRoot}"
          .lines="${this.dmlLines}"
          .highlightIndex="${this.dmlHighlightIndex}"
        ></dml-view>`;
      case 'soql':
        return html`<soql-view
          .timelineRoot="${this.timelineRoot}"
          .lines="${this.soqlLines}"
          .highlightIndex="${this.soqlHighlightIndex}"
        ></soql-view>`;
      case 'sosl':
        return html`<sosl-view
          .timelineRoot="${this.timelineRoot}"
          .lines="${this.soslLines}"
          .highlightIndex="${this.soslHighlightIndex}"
        ></sosl-view>`;
    }
  }

  private _toggle(kind: SectionKind) {
    this.collapsed = { ...this.collapsed, [kind]: !this.collapsed[kind] };
  }

  /** Cumulative limits are only present when the log recorded a usage snapshot. */
  private get _hasLimits(): boolean {
    return (this.timelineRoot?.governorLimits.snapshots.length ?? 0) > 0;
  }

  private _rows(kind: SectionKind): number {
    switch (kind) {
      case 'dml':
        return this.dmlLines.reduce((sum, l) => sum + l.dmlRowCount.self, 0);
      case 'soql':
        return this.soqlLines.reduce((sum, l) => sum + l.soqlRowCount.self, 0);
      case 'sosl':
        return this.soslLines.reduce((sum, l) => sum + l.soslRowCount.self, 0);
    }
  }

  private _count(kind: SectionKind): number {
    return kind === 'dml'
      ? this.dmlLines.length
      : kind === 'soql'
        ? this.soqlLines.length
        : this.soslLines.length;
  }

  private _used(value: number): number | null {
    return this._hasLimits ? value : null;
  }

  /** Without a snapshot the limit is the platform default, which is a guess here, so hide it. */
  private _limit(value: number): number {
    return this._hasLimits ? value : 0;
  }

  private _isEmpty(kind: SectionKind): boolean {
    const limits = this._limits;
    const consumed = limits ? SECTION_META[kind].statement(limits).used : 0;
    return this._count(kind) === 0 && consumed === 0;
  }

  /** The tracked-vs-consumed cards for a section. */
  private _sectionMetrics(kind: SectionKind): DatabaseMetric[] {
    const limits = this._limits;
    const statement = limits ? SECTION_META[kind].statement(limits) : { used: 0, limit: 0 };
    const rows = limits ? SECTION_META[kind].rows(limits) : { used: 0, limit: 0 };
    const metrics: DatabaseMetric[] = [
      {
        label: SECTION_META[kind].statementLabel,
        found: this._count(kind),
        used: this._used(statement.used),
        limit: this._limit(statement.limit),
      },
    ];
    if (kind === 'sosl') {
      // SOSL rows aren't a transaction total — the ceiling is derived from the
      // SOSL-query limit; without a snapshot it degrades to "limit n/a". The
      // per-query cap is shown on hover and metered per row in the table.
      const total = this._rows(kind);
      metrics.push({
        label: 'Rows',
        found: total,
        ...soslRowsMetric(total, limits?.soslQueries.limit ?? 0, this._hasLimits),
      });
    } else {
      metrics.push({
        label: 'Rows',
        found: this._rows(kind),
        used: this._used(rows.used),
        limit: this._limit(rows.limit),
      });
    }
    return metrics;
  }

  /**
   * The overview strip gauges: statement counts then row counts. The full core
   * set is always shown (even at zero) so gauge positions stay stable across
   * logs and confirm coverage; fully-zero gauges are muted by the component.
   */
  private _stripMetrics(): GaugeMetric[] {
    if (!this.loaded) {
      return [];
    }
    const limits = this._limits;
    const gauges: GaugeMetric[] = [];
    const add = (label: string, found: number, metric: { used: number; limit: number }) => {
      gauges.push({
        label,
        found,
        used: this._used(metric.used),
        limit: this._limit(metric.limit),
      });
    };
    const z = { used: 0, limit: 0 };
    add('DML', this._count('dml'), limits?.dmlStatements ?? z);
    add('SOQL', this._count('soql'), limits?.soqlQueries ?? z);
    add('SOSL', this._count('sosl'), limits?.soslQueries ?? z);
    add('DML Rows', this._rows('dml'), limits?.dmlRows ?? z);
    add('Query Rows', this._rows('soql'), limits?.queryRows ?? z);
    return gauges;
  }

  _findHandler = (
    e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>,
  ) => {
    this._find(e.detail);
  };

  _find = (arg: { count: number }) => {
    const matchIndex = arg.count;
    if (matchIndex <= this.dmlMatches) {
      this.dmlHighlightIndex = matchIndex;
      this.soqlHighlightIndex = 0;
      this.soslHighlightIndex = 0;
    } else if (matchIndex <= this.dmlMatches + this.soqlMatches) {
      this.soqlHighlightIndex = matchIndex - this.dmlMatches;
      this.dmlHighlightIndex = 0;
      this.soslHighlightIndex = 0;
    } else {
      this.soslHighlightIndex = matchIndex - this.dmlMatches - this.soqlMatches;
      this.dmlHighlightIndex = 0;
      this.soqlHighlightIndex = 0;
    }
  };

  _findResults = (e: CustomEvent<{ totalMatches: number; type: SectionKind }>) => {
    if (e.detail.type === 'dml') {
      this.dmlMatches = e.detail.totalMatches;
    } else if (e.detail.type === 'soql') {
      this.soqlMatches = e.detail.totalMatches;
    } else if (e.detail.type === 'sosl') {
      this.soslMatches = e.detail.totalMatches;
    }

    this._find({ count: 1 });

    document.dispatchEvent(
      new CustomEvent('lv-find-results', {
        detail: { totalMatches: this.dmlMatches + this.soqlMatches + this.soslMatches },
      }),
    );
  };
}

interface SectionSpec {
  title: string;
  statementLabel: string;
  statement: (limits: Limits) => { used: number; limit: number };
  rows: (limits: Limits) => { used: number; limit: number };
}

// Which governor each type reconciles against. Order of use is DML, SOQL, SOSL —
// DML first (as it always has been), SOSL last (usually absent).
const SECTION_META: Record<SectionKind, SectionSpec> = {
  dml: {
    title: 'DML',
    statementLabel: 'Statements',
    statement: (l) => l.dmlStatements,
    rows: (l) => l.dmlRows,
  },
  soql: {
    title: 'SOQL',
    statementLabel: 'Queries',
    statement: (l) => l.soqlQueries,
    rows: (l) => l.queryRows,
  },
  sosl: {
    title: 'SOSL',
    statementLabel: 'Searches',
    statement: (l) => l.soslQueries,
    rows: (l) => l.queryRows,
  },
};
