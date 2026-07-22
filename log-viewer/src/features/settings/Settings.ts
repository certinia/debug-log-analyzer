/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { vscodeMessenger } from '../../core/messaging/VSCodeExtensionMessenger.js';

/* eslint-disable @typescript-eslint/naming-convention */
export type LanaSettings = {
  timeline: {
    activeTheme: string;
    colors: {
      Method: string;
      'Code Unit': string;
      'System Method': string;
      Workflow: string;
      DML: string;
      SOQL: string;
    };
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
};

export function getSettings(): Promise<LanaSettings> {
  return vscodeMessenger.request<LanaSettings>('getConfig').then((msg) => {
    return msg;
  });
}

/** Persists a `lana.*` setting via the extension (fire-and-forget). */
export function updateSetting(section: string, value: unknown): void {
  vscodeMessenger.send('updateConfig', { section, value });
}
