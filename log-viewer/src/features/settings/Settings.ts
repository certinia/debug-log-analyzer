/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { vscodeMessenger } from '../../core/messaging/VSCodeExtensionMessenger.js';

/* eslint-disable @typescript-eslint/naming-convention */
export type LanaSettings = {
  timeline: {
    activeTheme: string;
    colors: {
      'Code Unit': '#88AE58';
      Workflow: '#51A16E';
      Method: '#2B8F81';
      Flow: '#5C8FA6';
      DML: '#B06868';
      SOQL: '#6D4C7D';
      'System Method': '#8D6E63';
    };
    customThemes: {
      [key: string]: {
        codeUnit: string;
        workflow: string;
        method: string;
        flow: string;
        dml: string;
        soql: string;
        system: string;
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
