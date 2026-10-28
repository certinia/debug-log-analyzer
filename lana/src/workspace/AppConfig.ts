/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ConfigurationTarget, workspace, type Memento } from 'vscode';

export interface Config {
  timeline: {
    activeTheme: string;
    customThemes: {
      [key: string]: {
        apex: string;
        codeUnit: string;
        system: string;
        automation: string;
        dml: string;
        soql: string;
        callout: string;
        validation: string;
      };
    };
    showTooltip: boolean;
  };
  callTree: {
    categoryColorize: boolean;
    columnView: string;
    columnOverrides: Record<string, string[]>;
  };
  database: {
    soql: { columnView: string; columnOverrides: Record<string, string[]> };
    dml: { columnView: string; columnOverrides: Record<string, string[]> };
    sosl: { columnView: string; columnOverrides: Record<string, string[]> };
  };
  // The app-wide inspector, fed by a selection on any tab.
  inspector: {
    position: 'left' | 'right' | 'bottom';
    // The rest is private globalState (see INSPECTOR_STATE_SECTIONS), not settings.
    size: number | null;
    bottomSize: number | null;
    collapsed: Record<string, boolean>;
    sectionOrder: Record<string, string[]>;
    hiddenSections: Record<string, boolean>;
    visible: boolean | null;
  };
  /** The VS Code look the webview's chrome follows. Read from `workbench`, not `lana`. */
  ui: { mode: 'modern' | 'classic' };
}

/** The `workbench` settings behind `Config.ui`; a change to one is pushed to the webview. */
export const UI_SETTINGS = ['workbench.experimental.modernUI'] as const;

function getUi(): Config['ui'] {
  const workbench = workspace.getConfiguration('workbench');
  // A VS Code older than Modern UI has no such setting, and only the classic look.
  const registered =
    workbench.inspect<boolean>('experimental.modernUI')?.defaultValue !== undefined;
  const modern = registered && workbench.get<boolean>('experimental.modernUI', true);
  return { mode: modern ? 'modern' : 'classic' };
}

export function getConfig(): Config {
  const config = workspace.getConfiguration('lana');
  // inspect returns an object separating defaults from user settings
  const inspected = config.inspect('timeline.customThemes');

  // We intentionally IGNORE inspected.defaultValue
  // We only merge Global (User Settings) and Workspace (.vscode/settings.json)
  const userThemes = {
    ...(inspected?.globalValue || {}),
    ...(inspected?.workspaceValue || {}),
  };

  const plainConfig = JSON.parse(JSON.stringify(config));
  // Override the customThemes with the merged themes, to exclude defaults
  plainConfig.timeline.customThemes = userThemes;
  // `lana.database.*` is private globalState, not a registered setting, so the merged
  // tree has no `database` branch at all on a profile that never wrote one (every
  // fresh install). Seed the shape `Config` promises before callers fill it in.
  const database = plainConfig.database ?? {};
  plainConfig.database = Object.fromEntries(
    (['soql', 'dml', 'sosl'] as const).map((view) => [
      view,
      { columnView: 'General', columnOverrides: {}, ...database[view] },
    ]),
  );
  plainConfig.ui = getUi();
  return plainConfig;
}

/** True when two resolved configs hold the same values, so nothing needs pushing. */
export function sameConfig(a: Config, b: Config): boolean {
  return sameValue(a, b);
}

// A structural walk, because the payload is a plain JSON tree with open-ended
// records (column overrides, custom themes) that no per-field check can cover.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

export function updateConfig(section: string, value: unknown): Thenable<void> {
  const config = workspace.getConfiguration('lana');
  return config.update(section, value, ConfigurationTarget.Global);
}

/**
 * Column overrides are opaque per-view field maps — private UI state, not user
 * preferences — so they persist in globalState rather than editable settings.
 */
export const COLUMN_OVERRIDE_SECTIONS = [
  'callTree.columnOverrides',
  'database.soql.columnOverrides',
  'database.dml.columnOverrides',
  'database.sosl.columnOverrides',
] as const;

/**
 * The column-view presets are the view a table was last left in — remembered UI
 * state, not a preference — so they persist privately in globalState rather than
 * as registered `lana.*` settings.
 */
export const COLUMN_VIEW_SECTIONS = [
  'callTree.columnView',
  'database.soql.columnView',
  'database.dml.columnView',
  'database.sosl.columnView',
] as const;

/**
 * The inspector's layout state (its size, which sections are collapsed, which it
 * hides, the order they are in, whether the panel is open) is remembered UI state
 * rather than a preference, so it persists in globalState. Dock position stays a
 * public `lana.inspector.*` setting. Section sizes are remembered nowhere: a
 * section takes the space its content and the panel allow.
 */
export const INSPECTOR_STATE_SECTIONS = [
  'inspector.size',
  'inspector.bottomSize',
  'inspector.collapsed',
  'inspector.sectionOrder',
  'inspector.hiddenSections',
  'inspector.visible',
] as const;

/** All sections routed to globalState instead of editable `lana.*` settings. */
export const PRIVATE_SECTIONS = [
  ...COLUMN_OVERRIDE_SECTIONS,
  ...COLUMN_VIEW_SECTIONS,
  ...INSPECTOR_STATE_SECTIONS,
] as const;

type ColumnOverrides = Record<string, string[]>;
type InspectorState = Pick<
  Config['inspector'],
  'size' | 'bottomSize' | 'collapsed' | 'sectionOrder' | 'hiddenSections' | 'visible'
>;

export function getInspectorState(globalState: Memento): InspectorState {
  return {
    size: globalState.get<number | null>('inspector.size', null),
    bottomSize: globalState.get<number | null>('inspector.bottomSize', null),
    collapsed: globalState.get<Record<string, boolean>>('inspector.collapsed', {}),
    sectionOrder: globalState.get<Record<string, string[]>>('inspector.sectionOrder', {}),
    hiddenSections: globalState.get<Record<string, boolean>>('inspector.hiddenSections', {}),
    visible: globalState.get<boolean | null>('inspector.visible', null),
  };
}

export function getColumnOverrides(globalState: Memento): Record<string, ColumnOverrides> {
  const overrides: Record<string, ColumnOverrides> = {};
  for (const section of COLUMN_OVERRIDE_SECTIONS) {
    overrides[section] = globalState.get<ColumnOverrides>(section, {});
  }
  return overrides;
}

export function getColumnViews(globalState: Memento): Record<string, string> {
  const views: Record<string, string> = {};
  for (const section of COLUMN_VIEW_SECTIONS) {
    views[section] = globalState.get<string>(section, 'General');
  }
  return views;
}

export function updatePrivateSection(
  globalState: Memento,
  section: string,
  value: unknown,
): Thenable<void> {
  return globalState.update(section, value);
}

/** Alias retained for callers that persist column overrides specifically. */
export const updateColumnOverride = updatePrivateSection;
