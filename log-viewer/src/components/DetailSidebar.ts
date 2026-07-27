/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { type DetailSelection, type DetailSource, eventBus } from '../core/events/EventBus.js';
import { buildDatabaseSections } from '../features/database/components/databaseSections.js';
import { getSettings, updateSetting } from '../features/settings/Settings.js';
import { globalStyles } from '../styles/global.styles.js';
import type { DockPosition } from './DetailDock.js';
import './DockLayout.js';
import type { PaneSection } from './PaneView.js';

/** Maps the LogViewer tab id to the detail source that feeds the side bar. */
const TAB_TO_SOURCE: Record<string, DetailSource> = {
  'timeline-tab': 'timeline',
  'tree-tab': 'calltree',
  'analysis-tab': 'analysis',
  'database-tab': 'database',
};

/**
 * The app-wide detail side bar. Lives at the app root (sibling of the tab strip,
 * via a forwarded `main` slot) so it crosscuts every tab. It follows the active
 * tab: each source's latest selection is remembered, and the bar shows the active
 * tab's selection. Persists dock position/size (public settings) and per-section
 * collapse (private globalState); visibility is transient (opens on first select).
 */
@customElement('detail-sidebar')
export class DetailSidebar extends LitElement {
  /** The active LogViewer tab id (e.g. `database-tab`); the bar follows it. */
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

  // Latest selection per source; the bar renders the active tab's entry.
  private _selections = new Map<DetailSource, DetailSelection>();
  // Auto-open only on the first selection; afterwards the user's toggle wins.
  private _hasAutoOpened = false;
  // Persisted per-section collapse (globalState), keyed by section id.
  private _collapsedSections: Record<string, boolean> = {};
  private _unsubscribe: Array<() => void> = [];

  constructor() {
    super();
    this._unsubscribe.push(
      eventBus.on('detail:select', (d) => this._onSelect(d)),
      eventBus.on('detail:toggle', (d) => this._onToggle(d)),
    );
    getSettings()
      .then((settings) => {
        const panel = settings?.sidePanel;
        if (panel) {
          this.dock = panel.position;
          this.panelSize = panel.size;
          this._collapsedSections = panel.collapsed ?? {};
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
        emptyText="Select a row to inspect it."
        @dock-position-change=${this._onDockPositionChange}
        @dock-resize=${this._onDockResize}
        @dock-hide=${this._hidePanel}
        @dock-collapse=${this._hidePanel}
        @pane-toggle=${this._onPaneToggle}
      >
        <slot slot="main" name="main"></slot>
      </dock-layout>
    `;
  }

  private _onSelect(detail: { source: DetailSource; selection: DetailSelection | null }): void {
    if (detail.selection) {
      this._selections.set(detail.source, detail.selection);
      if (!this._hasAutoOpened) {
        this._hasAutoOpened = true;
        this.panelVisible = true;
      }
    } else {
      this._selections.delete(detail.source);
    }
    // Only rebuild if the change is for the tab currently on screen.
    if (TAB_TO_SOURCE[this.activeTab] === detail.source) {
      void this._rebuild();
    }
  }

  private _onToggle(detail: { visible?: boolean }): void {
    this.panelVisible = detail.visible ?? !this.panelVisible;
  }

  private async _rebuild(): Promise<void> {
    const source = TAB_TO_SOURCE[this.activeTab];
    const selection = source ? (this._selections.get(source) ?? null) : null;
    this.sections = selection ? await this._buildSections(source!, selection) : [];
  }

  private async _buildSections(
    source: DetailSource,
    selection: DetailSelection,
  ): Promise<PaneSection[]> {
    // Phase 1: only Database is wired; other sources gain builders in later phases.
    if (source === 'database' && selection.kind === 'event' && selection.type) {
      return buildDatabaseSections(
        { eventIndex: selection.eventIndex, type: selection.type },
        this._collapsedSections,
      );
    }
    return [];
  }

  private _onDockPositionChange = (e: CustomEvent<{ position: DockPosition }>) => {
    this.dock = e.detail.position;
    updateSetting('sidePanel.position', this.dock);
  };

  // `dock-resize` fires once on pointer-up, so this write already lands on
  // interaction-end — no debounce needed.
  private _onDockResize = (e: CustomEvent<{ size: number }>) => {
    this.panelSize = e.detail.size;
    updateSetting('sidePanel.size', this.panelSize);
  };

  private _onPaneToggle = (e: CustomEvent<{ collapsed: Record<string, boolean> }>) => {
    this._collapsedSections = { ...this._collapsedSections, ...e.detail.collapsed };
    updateSetting('sidePanel.collapsed', this._collapsedSections);
  };

  private _hidePanel = () => {
    this.panelVisible = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'detail-sidebar': DetailSidebar;
  }
}
