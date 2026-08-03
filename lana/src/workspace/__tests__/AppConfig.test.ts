/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Memento } from 'vscode';
import { workspace } from 'vscode';

import {
  COLUMN_OVERRIDE_SECTIONS,
  getColumnOverrides,
  getConfig,
  sameConfig,
  updateColumnOverride,
  type Config,
} from '../AppConfig.js';

function mockMemento(store: Record<string, unknown> = {}): Memento {
  return {
    keys: jest.fn(() => Object.keys(store)),
    get: jest.fn((key: string, fallback?: unknown) =>
      key in store ? store[key] : fallback,
    ) as Memento['get'],
    update: jest.fn(() => Promise.resolve()),
  } as unknown as Memento;
}

function mockLanaConfig(values: Record<string, unknown>): void {
  const config = {
    ...values,
    get: jest.fn(),
    has: jest.fn(() => false),
    inspect: jest.fn(() => undefined),
    update: jest.fn(),
  };
  jest
    .mocked(workspace.getConfiguration)
    .mockReturnValue(config as unknown as ReturnType<typeof workspace.getConfiguration>);
}

describe('getConfig', () => {
  afterEach(() => {
    jest.mocked(workspace.getConfiguration).mockReset();
  });

  it('seeds the database branch the merged settings tree never carries', () => {
    // `lana.database.*` is private globalState, so a fresh profile has no branch.
    mockLanaConfig({ timeline: {}, callTree: {}, inspector: {} });

    const config = getConfig();

    for (const view of ['soql', 'dml', 'sosl'] as const) {
      expect(config.database[view]).toEqual({ columnView: 'General', columnOverrides: {} });
    }
  });

  it('keeps values a legacy settings.json still carries', () => {
    mockLanaConfig({
      timeline: {},
      callTree: {},
      inspector: {},
      database: { soql: { columnView: 'Governor Limits' } },
    });

    const config = getConfig();

    expect(config.database.soql).toEqual({
      columnView: 'Governor Limits',
      columnOverrides: {},
    });
    expect(config.database.dml.columnView).toBe('General');
  });
});

describe('sameConfig', () => {
  const base = (): Config =>
    ({
      timeline: { activeTheme: 'Dark', legacy: false, customThemes: { Custom: {} } },
      callTree: { columnView: 'General', columnOverrides: { Time: ['a', 'b'] } },
    }) as unknown as Config;

  it('holds when every value matches', () => {
    expect(sameConfig(base(), base())).toBe(true);
  });

  it('sees a changed value inside an open-ended record', () => {
    const changed = base();
    changed.callTree.columnOverrides.Time = ['a', 'c'];

    expect(sameConfig(base(), changed)).toBe(false);
  });

  it('sees an added key', () => {
    const changed = base();
    changed.callTree.columnOverrides.Governor = ['x'];

    expect(sameConfig(base(), changed)).toBe(false);
  });
});

describe('AppConfig column overrides', () => {
  describe('getColumnOverrides', () => {
    it('reads each override section, defaulting to {}', () => {
      const globalState = mockMemento({
        'callTree.columnOverrides': { Time: ['a', 'b'] },
      });

      const overrides = getColumnOverrides(globalState);

      expect(overrides['callTree.columnOverrides']).toEqual({ Time: ['a', 'b'] });
      expect(overrides['database.soql.columnOverrides']).toEqual({});
      expect(overrides['database.dml.columnOverrides']).toEqual({});
      expect(globalState.get).toHaveBeenCalledTimes(COLUMN_OVERRIDE_SECTIONS.length);
    });
  });

  describe('updateColumnOverride', () => {
    it('writes only to globalState', () => {
      const globalState = mockMemento();
      const value = { Time: ['a'] };

      updateColumnOverride(globalState, 'callTree.columnOverrides', value);

      expect(globalState.update).toHaveBeenCalledWith('callTree.columnOverrides', value);
    });
  });
});
