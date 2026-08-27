/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

// The tabulator ESM build doesn't load under jest, and the module registers
// itself on import.
jest.mock('tabulator-tables', () => ({
  Module: class {
    constructor(_table: unknown) {}
    registerTableOption() {}
    setOption() {}
  },
  Tabulator: { registerModule: () => {} },
  KeybindingsModule: {},
  SelectRowModule: {},
}));

import { withCodeDrivenExpand } from '../expandOrigin.js';
import { RowKeyboardNavigation } from '../RowKeyboardNavigation.js';

function setup(selected: RowComponent[] = []) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const holder = { focus: jest.fn() };
  const table = {
    options: {},
    on: (evt: string, fn: (...args: unknown[]) => void) => {
      (handlers[evt] ??= []).push(fn);
    },
    element: { querySelector: () => holder },
    getSelectedRows: () => selected,
  };
  const plugin = new RowKeyboardNavigation(table as never);
  plugin.initialize();

  const row = { select: jest.fn() } as unknown as RowComponent;
  const expand = () => handlers['dataTreeRowExpanded']?.forEach((fn) => fn(row, 0));
  return { handlers, holder, row, expand };
}

describe('RowKeyboardNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects and focuses the row the user expanded first', () => {
    const { row, holder, expand } = setup();

    expand();

    expect(row.select).toHaveBeenCalled();
    expect(holder.focus).toHaveBeenCalled();
  });

  it('leaves an existing selection where it is', () => {
    const selected = { select: jest.fn() } as unknown as RowComponent;
    const { row, holder, expand } = setup([selected]);

    expand();

    expect(row.select).not.toHaveBeenCalled();
    expect(holder.focus).not.toHaveBeenCalled();
  });

  it('does not answer a collapse at all', () => {
    const { handlers } = setup();

    expect(handlers['dataTreeRowCollapsed']).toBeUndefined();
  });

  it('ignores an expansion the code drove', () => {
    const { row, holder, expand } = setup();

    withCodeDrivenExpand(expand);

    expect(row.select).not.toHaveBeenCalled();
    expect(holder.focus).not.toHaveBeenCalled();
  });
});
