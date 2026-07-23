/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ApexLog } from 'apex-log-parser';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

import type { DockPosition } from '../../../components/DetailDock.js';
import type { PaneSection } from '../../../components/PaneView.js';
import { getSettings, setSetting } from '../../settings/Settings.js';
import type { DMLView } from './DMLView.js';
import { buildDatabaseSections, type DetailSelection } from './databaseSections.js';
import type { SOQLView } from './SOQLView.js';

// web components
import '../../../components/DockLayout.js';
import './DMLView.js';
import './DatabaseSection.js';
import './SOQLView.js';

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  dmlMatches = 0;
  soqlMatches = 0;

  @state()
  dmlHighlightIndex = 0;
  @state()
  soqlHighlightIndex = 0;

  @state()
  selection: DetailSelection | null = null;
  @state()
  sections: PaneSection[] = [];
  @state()
  dock: DockPosition = 'right';
  // Visibility is transient session state: the panel starts hidden and opens on
  // the first row selection (persisting it would show an empty panel on load).
  @state()
  panelVisible = false;
  @state()
  panelSize = 300;

  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap = {};

  constructor() {
    super();

    document.addEventListener('db-find-results', this._findResults as EventListener);
    document.addEventListener('lv-find-match', this._findHandler as EventListener);
    document.addEventListener('lv-find', this._findHandler as EventListener);
    document.addEventListener('db-row-select', this._rowSelect as EventListener);
    document.addEventListener('db-toggle-panel', this._togglePanel as EventListener);

    getSettings()
      .then((settings) => {
        const panel = settings?.database?.detailPanel;
        if (panel) {
          this.dock = panel.position;
          this.panelSize = panel.size;
        }
      })
      .catch(() => {
        /* settings unavailable (e.g. outside the extension host) — keep defaults */
      });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('db-find-results', this._findResults as EventListener);
    document.removeEventListener('lv-find-match', this._findHandler as EventListener);
    document.removeEventListener('lv-find', this._findHandler as EventListener);
    document.removeEventListener('db-row-select', this._rowSelect as EventListener);
    document.removeEventListener('db-toggle-panel', this._togglePanel as EventListener);
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        height: 100%;
        width: 100%;
        background-color: var(--vscode-editor-background);
      }

      dock-layout {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
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
    `,
  ];

  render() {
    return html`
      <dock-layout
        dock=${this.dock}
        .size=${this.panelSize}
        ?visible=${this.panelVisible}
        .sections=${this.sections}
        emptyText="Select a DML or SOQL row to inspect it."
        @dock-position-change=${this._onDockPositionChange}
        @dock-resize=${this._onDockResize}
        @dock-hide=${this._hidePanel}
        @dock-collapse=${this._hidePanel}
      >
        <div class="db-grids" slot="main">
          <dml-view
            .timelineRoot="${this.timelineRoot}"
            .highlightIndex="${this.dmlHighlightIndex}"
          ></dml-view>
          <soql-view
            .timelineRoot="${this.timelineRoot}"
            .highlightIndex="${this.soqlHighlightIndex}"
          ></soql-view>
        </div>
      </dock-layout>
    `;
  }

  private _rowSelect = (e: CustomEvent<DetailSelection>) => {
    void this._select(e.detail);
  };

  private async _select(selection: DetailSelection) {
    this.selection = selection;
    this.panelVisible = true;
    // Only one statement is "selected" across both grids at a time.
    const other = selection.type === 'dml' ? this._soqlView : this._dmlView;
    other?.deselectRows();
    this.sections = await buildDatabaseSections(selection);
  }

  private _togglePanel = () => {
    this.panelVisible = !this.panelVisible;
  };

  private get _dmlView(): DMLView | null {
    return this.renderRoot?.querySelector('dml-view') ?? null;
  }

  private get _soqlView(): SOQLView | null {
    return this.renderRoot?.querySelector('soql-view') ?? null;
  }

  private _onDockPositionChange = (e: CustomEvent<{ position: DockPosition }>) => {
    this.dock = e.detail.position;
    setSetting('database.detailPanel.position', this.dock);
  };

  private _onDockResize = (e: CustomEvent<{ size: number }>) => {
    this.panelSize = e.detail.size;
    setSetting('database.detailPanel.size', this.panelSize);
  };

  private _hidePanel = () => {
    this.panelVisible = false;
  };

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
    } else {
      this.soqlHighlightIndex = matchIndex - this.dmlMatches;
      this.dmlHighlightIndex = 0;
    }
  };

  _findResults = (e: CustomEvent<{ totalMatches: number; type: 'dml' | 'soql' }>) => {
    if (e.detail.type === 'dml') {
      this.dmlMatches = e.detail.totalMatches;
    } else if (e.detail.type === 'soql') {
      this.soqlMatches = e.detail.totalMatches;
    }

    this._find({ count: 1 });

    document.dispatchEvent(
      new CustomEvent('lv-find-results', {
        detail: { totalMatches: this.dmlMatches + this.soqlMatches },
      }),
    );
  };
}
