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
/** Newest settings seen, from either the reply or a push; seeds later subscribers. */
let latest: LanaSettings | null = null;
let seedRequest: Promise<LanaSettings | null> | null = null;

function publish(settings: LanaSettings): void {
  latest = settings;
  subscribers.forEach((notify) => {
    notify(settings);
  });
}

/**
 * Delivers the current settings, then every later edit, and returns the
 * unsubscribe function. The panel keeps its context when hidden and is never
 * re-created, so the push is the only way live edits (theme colors) reach the UI —
 * seeding and following are one call so a consumer cannot take half the contract.
 */
export function subscribeSettings(callback: (settings: LanaSettings) => void): () => void {
  subscribers.add(callback);

  if (!listening) {
    // One window listener for every subscriber; `listen` has no removal path.
    listening = true;
    VSCodeExtensionMessenger.listen<LanaSettings>((event) => {
      const settings = event.data?.cmd === 'configChanged' ? event.data.payload : null;
      if (settings) {
        publish(settings);
      }
    });
  }

  if (latest) {
    callback(latest);
  } else {
    // One request however many subscribers; later ones reuse the same reply.
    // No extension host to ask (standalone browser): the UI keeps its defaults.
    seedRequest ??= getSettings().catch(() => null);
    seedRequest.then((settings) => {
      // A push can land before the reply; it is then the newer value, so the
      // reply is dropped rather than applied over it.
      if (settings && !latest) {
        publish(settings);
      }
    });
  }

  return () => {
    subscribers.delete(callback);
  };
}

/** Persists a `lana.*` setting via the extension (fire-and-forget). */
export function updateSetting(section: string, value: unknown): void {
  vscodeMessenger.send('updateConfig', { section, value });
}
