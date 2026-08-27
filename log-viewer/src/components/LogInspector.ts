/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  TAB_TO_SOURCE,
  type DetailSelection,
  type DetailSource,
  type SelectionView,
  eventBus,
} from '../core/events/EventBus.js';
import type { InspectorLocateEvent, InspectorRevealEvent } from './inspectorReveal.js';
import { debounce } from '../core/utility/Util.js';
import { getSettings, updateSetting } from '../features/settings/Settings.js';
import { emptyTextFor } from './detailEmptyText.js';
import { buildDetailSections } from './detailSections.js';
import { globalStyles } from '../styles/global.styles.js';
import type { DockPosition } from './DetailDock.js';
import './DockLayout.js';
import type { PaneOrientation, PaneSection } from './PaneView.js';
import './ViewModeSwitch.js';
import type { ViewModeOption } from './ViewModeSwitch.js';

/** What the panel is reading: the selected row, or the whole log. */
type InspectorScope = 'selection' | 'log';

const SCOPE_OPTIONS: readonly ViewModeOption[] = [
  { value: 'selection', label: 'Detail' },
  { value: 'log', label: 'Summary' },
];

/**
 * The app-wide inspector. Lives at the app root (sibling of the tab strip,
 * via a forwarded `main` slot) so it crosscuts every tab. It follows the active
 * tab: each source's latest selection is remembered, and it shows the active
 * tab's selection. Persists dock position/size (public settings) plus its
 * open/closed state, section collapse and pane sizes (private globalState).
 */
@customElement('log-inspector')
export class LogInspector extends LitElement {
  /** The active LogViewer tab id (e.g. `database-tab`); the inspector follows it. */
  @property({ type: String })
  activeTab = '';

  @state()
  private sections: PaneSection[] = [];
  @state()
  private dock: DockPosition = 'right';
  @state()
  private panelSize = 500;

  // Keyed by section id and shared by every tab — one panel, one layout.
  @state()
  private collapsedSections: Record<string, boolean> = {};
  @state()
  private paneSizes: Record<string, number> = {};

  // Latest selection per source; the bar renders the active tab's entry.
  private _selections = new Map<DetailSource, DetailSelection>();
  // What the inspector has walked to inside that selection, per source: one
  // frame, or the calls a picked row counts where its rows merge occurrences.
  // Held apart from the selection so the call stack keeps its anchor while
  // Details and the call tree follow the walk.
  private _active = new Map<DetailSource, DetailSelection>();

  /** The direction each tab is showing, so the inspector can open on the other. */
  private _sourceViews = new Map<DetailSource, SelectionView | undefined>();
  // The source a locate mark was last sent to, while one is showing.
  private _locatedSource: DetailSource | undefined;
  // Shared by every tab, like the layout is, but never persisted: it is reading
  // state, and a remembered log scope would fight the next selection.
  @state()
  private _scope: InspectorScope = 'selection';
  // The user's last open/closed choice, or null if they've never made one —
  // which is the only state that lets a selection auto-open the panel.
  @state()
  private _visiblePref: boolean | null = null;
  // Set once a selection has opened the panel on the user's behalf.
  @state()
  private _autoOpened = false;
  // Set as soon as the user docks, resizes or collapses anything, so a settings
  // load still in flight can't overwrite what they just did.
  private _userAdjusted = false;
  // Guards against a slow rebuild resolving after a newer selection.
  private _rebuildEpoch = 0;
  private _unsubscribe: Array<() => void> = [];

  constructor() {
    super();
    this._unsubscribe.push(
      eventBus.on('detail:select', (d) => this._onSelect(d)),
      eventBus.on('detail:view', (d) => this._onView(d)),
      eventBus.on('detail:toggle', (d) => this._onToggle(d)),
    );
    getSettings()
      .then((settings) => {
        const panel = settings?.inspector;
        if (!panel) {
          return;
        }
        // The load can land after the user has already opened or laid out the
        // panel, so their own choice always wins over the stored one.
        this._visiblePref ??= panel.visible ?? null;
        if (!this._userAdjusted) {
          this.dock = panel.position;
          this.panelSize = panel.size;
          this.collapsedSections = panel.collapsed ?? {};
          this.paneSizes = panel.paneSizes ?? {};
        }
      })
      .catch(() => {
        /* settings unavailable (e.g. outside the extension host) — keep defaults */
      });
  }

  // Open when the user says so, else only if a selection auto-opened it.
  private get _visible(): boolean {
    return this._visiblePref ?? this._autoOpened;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const off of this._unsubscribe) {
      off();
    }
    this._unsubscribe = [];
  }

  updated(changed: PropertyValues): void {
    if (changed.has('activeTab')) {
      // The tab the mark was for is no longer on screen, and the pointer left
      // the row without the table noticing.
      this._clearLocate();
      void this._rebuild();
    }
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
      }
      dock-layout {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
      }
      /* Slotted into the dock, so only a rule out here beats the switch's own
         default height. */
      view-mode-switch {
        --filter-control-height: var(--filter-control-height-dense);
      }
    `,
  ];

  render() {
    return html`
      <dock-layout
        dock=${this.dock}
        .size=${this.panelSize}
        ?visible=${this._visible}
        .sections=${this.sections}
        .collapsed=${this.collapsedSections}
        .paneSizes=${this.paneSizes}
        emptyText=${emptyTextFor(this._activeSource)}
        @dock-position-change=${this._onDockPositionChange}
        @dock-resize=${this._onDockResize}
        @dock-hide=${this._hidePanel}
        @dock-collapse=${this._hidePanel}
        @pane-toggle=${this._onPaneToggle}
        @pane-resize=${this._onPaneResize}
        @inspector-reveal=${this._onReveal}
        @inspector-locate=${this._onLocate}
      >
        <slot slot="main" name="main"></slot>
        ${this._scopeSwitch()}
      </dock-layout>
    `;
  }

  /** Only with a selection to switch away from: one live choice is noise. */
  private _scopeSwitch() {
    const source = this._activeSource;
    if (!source || !this._selections.has(source)) {
      return '';
    }
    return html`<view-mode-switch
      slot="actions-start"
      aria-label="Inspector scope"
      title="Read what you selected, or this tab's summary of the whole log"
      .options=${SCOPE_OPTIONS}
      value=${this._scope}
      @view-mode-change=${(e: CustomEvent<{ value: string }>) =>
        this._setScope(e.detail.value as InspectorScope)}
    ></view-mode-switch>`;
  }

  private get _activeSource(): DetailSource | undefined {
    return TAB_TO_SOURCE[this.activeTab];
  }

  /** Log scope holds the tab's selection back rather than clearing it, so switching back restores it. */
  private _scopedSelection(source: DetailSource): DetailSelection | null {
    return this._scope === 'log' ? null : (this._selections.get(source) ?? null);
  }

  private _setScope(scope: InspectorScope): void {
    this._scope = scope;
    this._scheduleRebuild();
  }

  /** A tab turned its own tree around, so what the inspector should answer with
   *  changed even though the selection did not. */
  private _onView(detail: { source: DetailSource; view: SelectionView }): void {
    if (this._sourceViews.get(detail.source) === detail.view) {
      return;
    }
    this._sourceViews.set(detail.source, detail.view);
    this._scheduleRebuild();
  }

  private _onSelect(detail: {
    source: DetailSource;
    selection: DetailSelection | null;
    view?: SelectionView;
  }): void {
    // A pick in the tab itself is a new anchor, so any walk down the old stack ends.
    this._active.delete(detail.source);
    this._sourceViews.set(detail.source, detail.view);
    if (detail.selection) {
      this._selections.set(detail.source, detail.selection);
      // A new pick means "show me this", so the panel comes back to it.
      this._scope = 'selection';
      // Only shows the panel while the user has never chosen for themselves,
      // which `_visible` decides.
      this._autoOpened = true;
    } else {
      this._selections.delete(detail.source);
    }
    // Only rebuild if the change is for the tab currently on screen.
    if (this._activeSource === detail.source) {
      this._scheduleRebuild();
    }
  }

  /**
   * An inspector row asks to be revealed. Only the active tab's own view acts on
   * it, so the source is stamped here - a call-tree selection must never move
   * the timeline.
   *
   * The revealed row also becomes the active frame: the tab's own selection
   * moves, and Details and the call tree follow, while the selection that
   * anchors the call stack stays where the user left it.
   */
  private _onReveal = (e: InspectorRevealEvent): void => {
    const source = this._activeSource;
    if (!source) {
      return;
    }
    eventBus.emit('inspector:reveal', { source, eventIndex: e.detail.eventIndex });
    // Without a selection the sections are the whole-log ones, which have no
    // frame to follow; the whole-log rows only reveal.
    if (this._scopedSelection(source)) {
      this._active.set(source, { kind: 'event', eventIndex: e.detail.eventIndex });
      this._scheduleRebuild();
    }
  };

  /**
   * A row is under the pointer: mark it in the active tab's view. Nothing is
   * selected and no section changes, so this never rebuilds the panel.
   */
  private _onLocate = (e: InspectorLocateEvent): void => {
    const source = this._activeSource;
    if (!source) {
      return;
    }
    this._locatedSource = e.detail.eventIndexes.length ? source : undefined;
    eventBus.emit('inspector:locate', {
      source,
      eventIndexes: e.detail.eventIndexes,
      sticky: e.detail.sticky,
    });
    if (!e.detail.sticky || !this._scopedSelection(source)) {
      return;
    }
    if (!e.detail.eventIndexes.length) {
      // The pick is being dropped, which hands Details back to the tab's own
      // selection.
      if (this._active.delete(source)) {
        this._scheduleRebuild();
      }
    } else if (e.detail.selection) {
      // A picked row that merges occurrences has no frame to walk to, so what it
      // counts is what Details answers about. A sticky mark with no such row
      // leaves the walk where it is.
      this._active.set(source, e.detail.selection);
      this._scheduleRebuild();
    }
  };

  /** Drops a mark left behind by a pointer that never left the row. Sticky, so a
   *  picked row's mark goes with it. */
  private _clearLocate(): void {
    if (this._locatedSource) {
      eventBus.emit('inspector:locate', {
        source: this._locatedSource,
        eventIndexes: [],
        sticky: true,
      });
      this._locatedSource = undefined;
    }
  }

  private _onToggle(detail: { visible?: boolean }): void {
    this._setVisible(detail.visible ?? !this._visible);
  }

  /** Every open/close is the user's, so each one is remembered. */
  private _setVisible(visible: boolean): void {
    if (!visible) {
      this._clearLocate();
    }
    this._visiblePref = visible;
    updateSetting('inspector.visible', visible);
  }

  /**
   * Coalesced to one rebuild per frame: holding an arrow key in the timeline
   * fires a selection per keydown (~20-30/s), and each rebuild re-creates the
   * section tables. Trailing rAF means we only ever build the latest selection.
   */
  private _scheduleRebuild = debounce(() => {
    void this._rebuild();
  });

  private async _rebuild(): Promise<void> {
    const epoch = ++this._rebuildEpoch;
    const source = this._activeSource;
    const sections = source
      ? await buildDetailSections(
          source,
          this._scopedSelection(source),
          this._active.get(source) ?? null,
          this._sourceViews.get(source),
        )
      : [];
    // Drop a slow build that a newer selection already superseded.
    if (epoch === this._rebuildEpoch) {
      this.sections = sections;
    }
  }

  private _onDockPositionChange = (e: CustomEvent<{ position: DockPosition }>) => {
    this._userAdjusted = true;
    this.dock = e.detail.position;
    updateSetting('inspector.position', this.dock);
  };

  // `dock-resize` fires once on pointer-up, so this write already lands on
  // interaction-end — no debounce needed.
  private _onDockResize = (e: CustomEvent<{ size: number }>) => {
    this._userAdjusted = true;
    this.panelSize = e.detail.size;
    updateSetting('inspector.size', this.panelSize);
  };

  private _onPaneToggle = (e: CustomEvent<{ collapsed: Record<string, boolean> }>) => {
    this._userAdjusted = true;
    this.collapsedSections = { ...this.collapsedSections, ...e.detail.collapsed };
    updateSetting('inspector.collapsed', this.collapsedSections);
  };

  // `pane-resize` fires on pointer-up, so this write lands on interaction-end.
  private _onPaneResize = (
    e: CustomEvent<{ sizes: Record<string, number>; orientation: PaneOrientation }>,
  ) => {
    this._userAdjusted = true;
    // Every size for the dragged axis arrives together, so that axis is
    // replaced, not merged: a pane reset to its content's size has no entry to
    // merge. The other axis' sizes are untouched.
    const prefix = `${e.detail.orientation}:`;
    const otherAxis = Object.entries(this.paneSizes).filter(([key]) => !key.startsWith(prefix));
    this.paneSizes = { ...Object.fromEntries(otherAxis), ...e.detail.sizes };
    updateSetting('inspector.paneSizes', this.paneSizes);
  };

  private _hidePanel = () => {
    this._setVisible(false);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'log-inspector': LogInspector;
  }
}
