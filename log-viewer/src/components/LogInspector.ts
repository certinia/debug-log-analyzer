/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { type DetailSelection, type DetailSource, eventBus } from '../core/events/EventBus.js';
import type { InspectorRevealEvent } from './inspectorReveal.js';
import { debounce } from '../core/utility/Util.js';
import { getSettings, updateSetting } from '../features/settings/Settings.js';
import { emptyTextFor } from './detailEmptyText.js';
import { buildDetailSections } from './detailSections.js';
import { globalStyles } from '../styles/global.styles.js';
import type { DockPosition } from './DetailDock.js';
import './DockLayout.js';
import type { PaneSection } from './PaneView.js';

/** Maps the LogViewer tab id to the detail source that feeds the inspector. */
const TAB_TO_SOURCE: Record<string, DetailSource> = {
  'timeline-tab': 'timeline',
  'tree-tab': 'calltree',
  'analysis-tab': 'analysis',
  'database-tab': 'database',
};

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
      >
        <slot slot="main" name="main"></slot>
      </dock-layout>
    `;
  }

  private get _activeSource(): DetailSource | undefined {
    return TAB_TO_SOURCE[this.activeTab];
  }

  private _onSelect(detail: { source: DetailSource; selection: DetailSelection | null }): void {
    if (detail.selection) {
      this._selections.set(detail.source, detail.selection);
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
   */
  private _onReveal = (e: InspectorRevealEvent): void => {
    const source = this._activeSource;
    if (source) {
      eventBus.emit('inspector:reveal', { source, eventIndex: e.detail.eventIndex });
    }
  };

  private _onToggle(detail: { visible?: boolean }): void {
    this._setVisible(detail.visible ?? !this._visible);
  }

  /** Every open/close is the user's, so each one is remembered. */
  private _setVisible(visible: boolean): void {
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
      ? await buildDetailSections(source, this._selections.get(source) ?? null)
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
  private _onPaneResize = (e: CustomEvent<{ sizes: Record<string, number> }>) => {
    this._userAdjusted = true;
    this.paneSizes = { ...this.paneSizes, ...e.detail.sizes };
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
