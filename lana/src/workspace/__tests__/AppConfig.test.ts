/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Memento } from 'vscode';

import {
  COLUMN_OVERRIDE_SECTIONS,
  getColumnOverrides,
  updateColumnOverride,
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
