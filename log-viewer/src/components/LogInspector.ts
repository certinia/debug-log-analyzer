/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

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
import {
  hiddenIds,
  keepUnbuilt,
  layoutKey,
  mergeOrder,
  orderSections,
  scopedKey,
  scopedRecord,
  withoutScope,
} from './inspectorLayout.js';
import { RESET_SECTIONS_ID, buildSectionMenuItems, sectionIdFor } from './sectionMenu.js';
import { globalStyles } from '../styles/global.styles.js';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import type { DockPosition } from './DetailDock.js';
import './DockLayout.js';
import type { PaneSection } from './PaneView.js';
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
 * open/closed state and its section layout (private globalState).
 *
 * Collapse, order and which sections show are remembered per section list — per
 * tab and per scope, see {@link layoutKey} — because one id means different
 * content in two lists. Section sizes are remembered nowhere: a section takes
 * the space its content and the panel allow, and a size dragged for one log is
 * the wrong one for the next.
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

  // Keyed `<source>:<scope>:<section id>`, so the same section keeps its own
  // state in each list it appears in.
  @state()
  private collapsedSections: Record<string, boolean> = {};
  // The order the user arranged each list in, keyed `<source>:<scope>`.
  @state()
  private sectionOrder: Record<string, string[]> = {};
  // The sections a list is set to hide, keyed like the collapse record.
  @state()
  private hiddenSections: Record<string, boolean> = {};
  // Bumped by a reset, which hands the panes' sizes back to automatic.
  @state()
  private _layoutEpoch = 0;

  // What the builder produced for the list on screen. Kept in its own order,
  // because that is what a reset goes back to.
  private _builtSections: PaneSection[] = [];
  // Everything else about that list, derived together in `_applyLayout` so the
  // four can never disagree: which list it is, every section of it in the order
  // the user arranged (hidden ones included, so the header menu can offer them
  // back), the ones it hides, and its collapse record by plain section id, which
  // is what `<pane-view>` takes.
  private _layout: {
    key: string;
    ordered: PaneSection[];
    hidden: ReadonlySet<string>;
    collapsed: Record<string, boolean>;
  } = { key: '', ordered: [], hidden: new Set(), collapsed: {} };

  @query('context-menu')
  private _menu?: ContextMenu;

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
          this.sectionOrder = panel.sectionOrder ?? {};
          this.hiddenSections = panel.hiddenSections ?? {};
          // A hidden section's build skips work, so the list is rebuilt rather
          // than filtered.
          void this._rebuild();
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
        .collapsed=${this._layout.collapsed}
        .layoutEpoch=${this._layoutEpoch}
        emptyText=${emptyTextFor(this._activeSource)}
        @dock-position-change=${this._onDockPositionChange}
        @dock-resize=${this._onDockResize}
        @dock-hide=${this._hidePanel}
        @dock-collapse=${this._hidePanel}
        @pane-toggle=${this._onPaneToggle}
        @pane-reorder=${this._onPaneReorder}
        @pane-menu=${this._onPaneMenu}
        @inspector-reveal=${this._onReveal}
        @inspector-locate=${this._onLocate}
      >
        <slot slot="main" name="main"></slot>
        ${this._scopeSwitch()}
      </dock-layout>
      <context-menu @menu-select=${this._onSectionMenuSelect}></context-menu>
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
    const selection = source ? this._scopedSelection(source) : null;
    const key = source ? layoutKey(source, selection ? 'detail' : 'summary') : '';
    // What this build skips. Read before the await, which is why `_applyLayout`
    // reads the store again rather than trusting it.
    const hidden = hiddenIds(this.hiddenSections, key);
    const sections = source
      ? await buildDetailSections(
          source,
          selection,
          this._active.get(source) ?? null,
          this._sourceViews.get(source),
          hidden,
        )
      : [];
    // Drop a slow build that a newer selection already superseded.
    if (epoch === this._rebuildEpoch) {
      this._builtSections = sections;
      this._applyLayout(key);
    }
  }

  /**
   * The built sections in this list's own order, and only the ones it shows.
   * Reads the stored set itself rather than taking one: a build's set is a
   * snapshot from before it awaited, and the user can hide a section while it
   * runs.
   */
  private _applyLayout(key = this._layout.key): void {
    const ordered = orderSections(this._builtSections, this.sectionOrder[key]);
    let hidden = hiddenIds(this.hiddenSections, key);
    // A stored set that hides every section — a list whose sections have changed
    // since — would leave no header to right-click, and that menu is the only way
    // back. Forgetting it is the way out, so the store agrees with the screen.
    if (ordered.length && ordered.every((section) => hidden.has(section.id))) {
      this.hiddenSections = withoutScope(this.hiddenSections, key);
      updateSetting('inspector.hiddenSections', this.hiddenSections);
      hidden = new Set();
      // They were built as hidden, so the work their build skipped is missing —
      // a badge, or anything else the section resolves up front.
      void this._rebuild();
    }
    this._layout = {
      key,
      ordered,
      hidden,
      collapsed: scopedRecord(this.collapsedSections, key),
    };
    this.sections = ordered.filter((section) => !hidden.has(section.id));
  }

  /** After a change to what this list shows: only a section coming back needs
   *  the work its build skipped. Settles before it resolves, so a caller can
   *  read the layout it produced. */
  private async _relayout(needsBuild: boolean): Promise<void> {
    if (needsBuild) {
      await this._rebuild();
    } else {
      this._applyLayout();
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
    // The pane names sections by id; the panel remembers them per list.
    const scoped = Object.entries(e.detail.collapsed).map(([id, value]) => [
      scopedKey(this._layout.key, id),
      value,
    ]);
    this.collapsedSections = { ...this.collapsedSections, ...Object.fromEntries(scoped) };
    this._layout = { ...this._layout, collapsed: e.detail.collapsed };
    updateSetting('inspector.collapsed', this.collapsedSections);
  };

  private _onPaneReorder = (e: CustomEvent<{ ids: string[] }>) => {
    this._userAdjusted = true;
    const ids = this._layout.ordered.map((section) => section.id);
    const arranged = mergeOrder(ids, this._layout.hidden, e.detail.ids);
    // What this build never produced is off screen like a hidden section, not
    // gone: a reorder under a DML row must not drop where they put SOQL issues.
    const order = keepUnbuilt(this.sectionOrder[this._layout.key] ?? [], arranged);
    this.sectionOrder = { ...this.sectionOrder, [this._layout.key]: order };
    updateSetting('inspector.sectionOrder', this.sectionOrder);
    this._applyLayout();
  };

  /** Offers every section of the list, hidden ones included, so any can come back. */
  private _onPaneMenu = (e: CustomEvent<{ x: number; y: number }>) => {
    this._menu?.show(this._sectionMenuItems(), e.detail.x, e.detail.y);
  };

  /** The menu stays open through a toggle, so its ticks are refreshed in place. */
  private _refreshSectionMenu(): void {
    if (this._menu?.isVisible()) {
      this._menu.items = this._sectionMenuItems();
    }
  }

  private _sectionMenuItems() {
    return buildSectionMenuItems(this._layout.ordered, this._layout.hidden);
  }

  private _onSectionMenuSelect = (e: CustomEvent<{ itemId: string }>) => {
    if (e.detail.itemId === RESET_SECTIONS_ID) {
      this._resetSections();
      return;
    }
    const id = sectionIdFor(e.detail.itemId);
    if (id) {
      void this._toggleSection(id);
    }
  };

  private async _toggleSection(id: string): Promise<void> {
    this._userAdjusted = true;
    const key = scopedKey(this._layout.key, id);
    const hidden = { ...this.hiddenSections };
    const bringingBack = !!hidden[key];
    if (bringingBack) {
      delete hidden[key];
    } else {
      hidden[key] = true;
    }
    this.hiddenSections = hidden;
    updateSetting('inspector.hiddenSections', this.hiddenSections);
    // Re-ticked from the layout the toggle produced, so a slow rebuild cannot
    // leave a row showing the state before the click.
    await this._relayout(bringingBack);
    this._refreshSectionMenu();
  }

  /**
   * This list back to its defaults: the order it is built in, every section
   * showing, and the panes' sizes automatic again. Collapse is left alone — it is
   * a live reading choice, and one click undoes it.
   */
  private _resetSections(): void {
    this._userAdjusted = true;
    const { [this._layout.key]: _cleared, ...order } = this.sectionOrder;
    this.sectionOrder = order;
    const hadHidden = this._layout.hidden.size > 0;
    this.hiddenSections = withoutScope(this.hiddenSections, this._layout.key);
    updateSetting('inspector.sectionOrder', this.sectionOrder);
    updateSetting('inspector.hiddenSections', this.hiddenSections);
    this._layoutEpoch++;
    void this._relayout(hadHidden);
  }

  private _hidePanel = () => {
    this._setVisible(false);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'log-inspector': LogInspector;
  }
}
