/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ConfigurationTarget, workspace, type Memento } from 'vscode';

interface Config {
  timeline: {
    activeTheme: string;
    colors: {
      /* eslint-disable @typescript-eslint/naming-convention */
      'Code Unit': '#88AE58';
      Workflow: '#51A16E';
      Method: '#2B8F81';
      Flow: '#5C8FA6';
      DML: '#B06868';
      SOQL: '#6D4C7D';
      'System Method': '#8D6E63';
      /* eslint-enable @typescript-eslint/naming-convention */
    };
    customThemes: {
      [key: string]: {
        /* eslint-disable @typescript-eslint/naming-convention */
        'Code Unit': string;
        Workflow: string;
        Method: string;
        Flow: string;
        DML: string;
        SOQL: string;
        'System Method': string;
        /* eslint-enable @typescript-eslint/naming-convention */
      };
    };
    legacy: boolean;
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
    size: number;
    // The rest is private globalState (see INSPECTOR_STATE_SECTIONS), not settings.
    collapsed: Record<string, boolean>;
    paneSizes: Record<string, number>;
    visible: boolean | null;
    callTreeMode: string;
  };
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
  return plainConfig;
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
 * The Database column-view presets persist privately in globalState (they are
 * not registered `lana.*` settings). `callTree.columnView` stays a public
 * setting.
 */
export const COLUMN_VIEW_SECTIONS = [
  'database.soql.columnView',
  'database.dml.columnView',
  'database.sosl.columnView',
] as const;

/**
 * The inspector's layout state (which sections are collapsed, their sizes, the
 * call tree's view mode, whether the panel is open) is remembered UI state
 * rather than a preference, so it persists in globalState. Dock position and
 * size stay public `lana.inspector.*` settings.
 */
export const INSPECTOR_STATE_SECTIONS = [
  'inspector.collapsed',
  'inspector.paneSizes',
  'inspector.visible',
  'inspector.callTreeMode',
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
  'collapsed' | 'paneSizes' | 'visible' | 'callTreeMode'
>;

export function getInspectorState(globalState: Memento): InspectorState {
  return {
    collapsed: globalState.get<Record<string, boolean>>('inspector.collapsed', {}),
    paneSizes: globalState.get<Record<string, number>>('inspector.paneSizes', {}),
    visible: globalState.get<boolean | null>('inspector.visible', null),
    callTreeMode: globalState.get<string>('inspector.callTreeMode', 'time-order'),
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
