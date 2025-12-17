/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ConfigurationTarget, workspace } from 'vscode';

interface Config {
  timeline: {
    activeTheme: string;
    colors: {
      /* eslint-disable @typescript-eslint/naming-convention */
      'Code Unit': '#88AE58';
      Workflow: '#51A16E';
      Method: '#2B8F81';
      Flow: '#337986';
      DML: '#285663';
      SOQL: '#5D4963';
      'System Method': '#5C3444';
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
