/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, type TemplateResult } from 'lit';

import type { ColumnView } from './grid/ColumnViews.js';
import type { ColumnSettingsController } from './ColumnSettingsController.js';
import type { ExpandableGrid } from './TreeExpandButton.js';

// web components
import '#vscode-elements/vscode-option.js';
import '#vscode-elements/vscode-toolbar-button.js';
import './TreeExpandButton.js';
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
}): TemplateResult {
  const { columns } = opts;
  return html`
    <vs-select
      dense
      slot="table-actions"
      id="${opts.id}"
      prefix="Columns"
      label="Column view"
      @change="${(event: Event) =>
        columns.choose((event.target as HTMLInputElement).value || 'General')}"
      @vs-reset-option="${(event: CustomEvent<{ value: string }>) =>
        columns.reset(event.detail.value)}"
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

/**
 * A tree grid's group controls: the `Group` picker when the grid groups, then the
 * expand button. The button comes last, so it keeps its place when the picker hides.
 */
export function gridGroupControls(opts: {
  grid: ExpandableGrid | null;
  /** For a tree one level deep: drops the menu and labels the button All. A click still steps one level. */
  wholeTree?: boolean;
  group?: {
    /** Per grid, since several share one document. */
    id: string;
    labels: readonly string[];
    /** The label on show; the first one when absent. */
    value?: string;
    onChange: (label: string) => void;
  };
}): TemplateResult {
  const { group } = opts;
  return html`
    ${
      group
        ? html`<vs-select
            dense
            slot="group"
            id="${group.id}"
            prefix="Group"
            label="Group by"
            .value="${group.value ?? group.labels[0]}"
            @change="${(event: Event) => group.onChange((event.target as HTMLInputElement).value)}"
          >
            ${group.labels.map((label) => html`<vscode-option>${label}</vscode-option>`)}
          </vs-select>`
        : nothing
    }
    <tree-expand-button
      slot="group"
      .grid=${opts.grid}
      ?whole-tree=${opts.wholeTree}
    ></tree-expand-button>
  `;
}

/** A grid's toolbar: open the column menu, export the rows, copy the rows. */
export function gridToolbarActions(opts: {
  openColumns: (event: Event) => void;
  exportToCSV: () => void;
  copyToClipboard: () => void;
}): TemplateResult {
  return html`
    <div slot="actions">
      <vscode-toolbar-button
        icon="list-selection"
        label="Columns"
        title="Columns"
        @click=${opts.openColumns}
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
