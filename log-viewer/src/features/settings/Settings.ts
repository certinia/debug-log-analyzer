/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import {
  VSCodeExtensionMessenger,
  vscodeMessenger,
} from '../../core/messaging/VSCodeExtensionMessenger.js';

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
  appearance: {
    /**
     * Panel chrome resolved by the extension — `cards` mirrors VS Code's modern
     * (floating panels) workbench, `flat` is the classic hairline-divider look. A
     * webview cannot see the workbench flag itself, so this only ever arrives over
     * a message; absent means `flat`.
     */
    chrome: 'cards' | 'flat';
  };
  // The app-wide inspector, fed by a selection on any tab.
  inspector: {
    position: 'left' | 'right' | 'bottom';
    size: number;
    /** Collapsed sections, keyed by section id — shared by every tab. */
    collapsed: Record<string, boolean>;
    /** Pane sizes (px, used as flex weights), keyed `<orientation>:<section id>`. */
    paneSizes: Record<string, number>;
    /** Last open/closed state; `null` means never toggled, so it may auto-open. */
    visible: boolean | null;
  };
};

export function getSettings(): Promise<LanaSettings> {
  return vscodeMessenger.request<LanaSettings>('getConfig').then((msg) => {
    return msg;
  });
}

const subscribers = new Set<(settings: LanaSettings) => void>();
let listening = false;

/**
 * Delivers the current settings, then every later edit, and returns the
 * unsubscribe function. The panel keeps its context when hidden and is never
 * re-created, so the push is the only way live edits (theme colors, panel chrome)
 * reach the UI — seeding and following are one call so a consumer cannot take
 * half the contract.
 */
export function subscribeSettings(callback: (settings: LanaSettings) => void): () => void {
  let pushed = false;
  const subscriber = (settings: LanaSettings) => {
    pushed = true;
    callback(settings);
  };
  subscribers.add(subscriber);

  if (!listening) {
    // One window listener for every subscriber; `listen` has no removal path.
    listening = true;
    VSCodeExtensionMessenger.listen<LanaSettings>((event) => {
      const settings = event.data?.cmd === 'configChanged' ? event.data.payload : null;
      if (settings) {
        subscribers.forEach((notify) => {
          notify(settings);
        });
      }
    });
  }

  // A push can land before the reply to this request; the reply is then the older
  // value, so drop it rather than applying it over the newer one.
  getSettings()
    .then((settings) => {
      if (!pushed) {
        subscriber(settings);
      }
    })
    .catch(() => {
      // No extension host to ask (standalone browser): the UI keeps its defaults.
    });

  return () => {
    subscribers.delete(subscriber);
  };
}

/** Persists a `lana.*` setting via the extension (fire-and-forget). */
export function updateSetting(section: string, value: unknown): void {
  vscodeMessenger.send('updateConfig', { section, value });
}
