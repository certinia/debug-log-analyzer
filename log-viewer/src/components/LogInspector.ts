/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { type DetailSelection, type DetailSource, eventBus } from '../core/events/EventBus.js';
import { debounce } from '../core/utility/Util.js';
import { getSettings, updateSetting } from '../features/settings/Settings.js';
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
  private panelVisible = false;
  @state()
  private panelSize = 500;

  // Collapse and pane sizes are keyed by section id and shared by every tab:
  // it's one panel, so "I don't need the Call stack" and a divider drag are
  // statements about the section, not about the tab that fed it.
  @state()
  private collapsedSections: Record<string, boolean> = {};
  @state()
  private paneSizes: Record<string, number> = {};

  // Latest selection per source; the bar renders the active tab's entry.
  private _selections = new Map<DetailSource, DetailSelection>();
  // The user's last open/closed choice, or null if they've never made one —
  // which is the only state that lets a selection auto-open the panel.
  private _visiblePref: boolean | null = null;
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
        if (panel) {
          this.dock = panel.position;
          this.panelSize = panel.size;
          this.collapsedSections = panel.collapsed ?? {};
          this.paneSizes = panel.paneSizes ?? {};
          this._visiblePref = panel.visible ?? null;
          // Settings can land after the first selection has already auto-opened
          // the panel, so an explicit choice always overrides that.
          if (this._visiblePref !== null) {
            this.panelVisible = this._visiblePref;
          }
        }
      })
      .catch(() => {
        /* settings unavailable (e.g. outside the extension host) — keep defaults */
      });
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
        ?visible=${this.panelVisible}
        .sections=${this.sections}
        .collapsed=${this.collapsedSections}
        .paneSizes=${this.paneSizes}
        emptyText="Select a row to inspect it."
        @dock-position-change=${this._onDockPositionChange}
        @dock-resize=${this._onDockResize}
        @dock-hide=${this._hidePanel}
        @dock-collapse=${this._hidePanel}
        @pane-toggle=${this._onPaneToggle}
        @pane-resize=${this._onPaneResize}
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
      // Auto-open only for a user who has never opened or closed it themselves.
      if (this._visiblePref === null) {
        this.panelVisible = true;
      }
    } else {
      this._selections.delete(detail.source);
    }
    // Only rebuild if the change is for the tab currently on screen.
    if (this._activeSource === detail.source) {
      this._scheduleRebuild();
    }
  }

  private _onToggle(detail: { visible?: boolean }): void {
    this._setVisible(detail.visible ?? !this.panelVisible);
  }

  /** Every open/close is the user's, so each one is remembered. */
  private _setVisible(visible: boolean): void {
    this.panelVisible = visible;
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
    const selection = source ? (this._selections.get(source) ?? null) : null;
    const sections = source ? await buildDetailSections(source, selection) : [];
    // Drop a slow build that a newer selection already superseded.
    if (epoch === this._rebuildEpoch) {
      this.sections = sections;
    }
  }

  private _onDockPositionChange = (e: CustomEvent<{ position: DockPosition }>) => {
    this.dock = e.detail.position;
    updateSetting('inspector.position', this.dock);
  };

  // `dock-resize` fires once on pointer-up, so this write already lands on
  // interaction-end — no debounce needed.
  private _onDockResize = (e: CustomEvent<{ size: number }>) => {
    this.panelSize = e.detail.size;
    updateSetting('inspector.size', this.panelSize);
  };

  private _onPaneToggle = (e: CustomEvent<{ collapsed: Record<string, boolean> }>) => {
    this.collapsedSections = { ...this.collapsedSections, ...e.detail.collapsed };
    updateSetting('inspector.collapsed', this.collapsedSections);
  };

  // `pane-resize` fires on pointer-up, so this write lands on interaction-end.
  private _onPaneResize = (e: CustomEvent<{ sizes: Record<string, number> }>) => {
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
