/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import '../../grid/index.js';
import type { LvGrid } from '../../grid/index.js';
import { gridColumnTarget, type ColumnSettingsController } from '../ColumnSettingsController.js';
import type { ContextMenu } from '../ContextMenu.js';
import { GridColumnMenuController } from '../GridColumnMenuController.js';

describe('GridColumnMenuController on an lv-grid', () => {
  it('applies the view, and opens the column menu at a right-click on the header', () => {
    const grid = document.createElement('lv-grid') as LvGrid;
    const items = [{ id: 'col:name', label: 'Name' }];
    const columns = { applyTo: jest.fn(), menuItems: jest.fn(() => items) };
    const show = jest.fn();
    const controller = new GridColumnMenuController({
      table: () => gridColumnTarget(grid),
      menu: () => ({ show }) as unknown as ContextMenu,
      columns: columns as unknown as ColumnSettingsController,
    });

    controller.initGrid(grid);
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, cancelable: true });
    grid.dispatchEvent(
      new CustomEvent('lv-grid-header-context', { detail: { column: 'name', event } }),
    );

    expect(columns.applyTo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(show).toHaveBeenCalledWith(items, 10, 20);
  });
});
