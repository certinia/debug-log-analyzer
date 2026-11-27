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
import { columnWidthItems } from '../grid/columnWidthMenu.js';

describe('GridColumnMenuController on an lv-grid', () => {
  it('opens the column menu at a right-click on the header', () => {
    const grid = document.createElement('lv-grid') as LvGrid;
    const items = [{ id: 'col:name', label: 'Name' }];
    const columns = { menuItems: jest.fn(() => items) };
    const show = jest.fn();
    const controller = new GridColumnMenuController({
      target: gridColumnTarget(grid),
      menu: () => ({ show }) as unknown as ContextMenu,
      columns: columns as unknown as ColumnSettingsController,
    });

    grid.addEventListener('lv-grid-header-context', controller.headerContext);
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 20, cancelable: true });
    grid.dispatchEvent(
      new CustomEvent('lv-grid-header-context', { detail: { column: 'name', event } }),
    );

    expect(event.defaultPrevented).toBe(true);
    expect(show).toHaveBeenCalledWith(items, 10, 20);
  });

  it('autosizes the right-clicked column, all columns, or resets them, on the grid', () => {
    const grid = document.createElement('lv-grid') as LvGrid;
    grid.autosizeColumn = jest.fn();
    grid.autosizeColumns = jest.fn();
    grid.resetColumnWidths = jest.fn();
    const controller = new GridColumnMenuController({
      target: gridColumnTarget(grid),
      menu: () => null,
      columns: {} as unknown as ColumnSettingsController,
    });

    const item = (label: string): string =>
      columnWidthItems('namespace').find((i) => i.label === label)?.id ?? '';

    expect(controller.select(item('Autosize Column'))).toBe(true);
    expect(grid.autosizeColumn).toHaveBeenCalledWith('namespace');
    expect(controller.select(item('Autosize All Columns'))).toBe(true);
    expect(grid.autosizeColumns).toHaveBeenCalled();
    expect(controller.select(item('Reset Column Widths'))).toBe(true);
    expect(grid.resetColumnWidths).toHaveBeenCalled();
    expect(controller.select('copy-name')).toBe(false);
  });
});
