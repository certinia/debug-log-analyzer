/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, type TemplateResult } from 'lit';

import type { ColumnView } from '../tabulator/ColumnViews.js';
import type { ColumnSettingsController } from './ColumnSettingsController.js';
import type { GridColumnMenuController } from './GridColumnMenuController.js';

// web components
import '#vscode-elements/vscode-option.js';
import '#vscode-elements/vscode-toolbar-button.js';
import './VsSelect.js';

/**
 * A grid's `Columns` picker: the presets on offer, which one is on show, and
 * which the user has edited and can therefore reset.
 */
export function columnViewSelect(opts: {
  /** Per grid, since several share one document. */
  id: string;
  views: ColumnView[];
  columns: ColumnSettingsController;
  menus: GridColumnMenuController;
}): TemplateResult {
  const { columns, menus } = opts;
  return html`
    <vs-select
      dense
      slot="table-actions"
      id="${opts.id}"
      prefix="Columns"
      label="Column view"
      @change="${menus.chooseView}"
      @vs-reset-option="${menus.resetView}"
      .value="${columns.view}"
      .resettableValues="${columns.editedViews}"
    >
      ${opts.views.map(
        (view) =>
          html`<vscode-option value="${view.id}" ?selected="${columns.view === view.id}"
            >${view.id}</vscode-option
          >`,
      )}
    </vs-select>
  `;
}

/** A grid's toolbar: open the column menu, export the rows, copy the rows. */
export function gridToolbarActions(opts: {
  menus: GridColumnMenuController;
  exportToCSV: () => void;
  copyToClipboard: () => void;
}): TemplateResult {
  return html`
    <div slot="actions">
      <vscode-toolbar-button
        icon="list-selection"
        label="Columns"
        title="Columns"
        @click=${opts.menus.open}
      ></vscode-toolbar-button>
      <vscode-toolbar-button
        icon="desktop-download"
        label="Export to CSV"
        title="Export to CSV"
        @click=${opts.exportToCSV}
      ></vscode-toolbar-button>
      <vscode-toolbar-button
        icon="copy"
        label="Copy to clipboard"
        title="Copy to clipboard"
        @click=${opts.copyToClipboard}
      ></vscode-toolbar-button>
    </div>
  `;
}
