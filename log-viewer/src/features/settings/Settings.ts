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
};

export function getSettings(): Promise<LanaSettings> {
  return vscodeMessenger.request<LanaSettings>('getConfig').then((msg) => {
    return msg;
  });
}
