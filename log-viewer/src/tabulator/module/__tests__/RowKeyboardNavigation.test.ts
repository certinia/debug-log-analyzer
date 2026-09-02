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
  const collapse = () => handlers['dataTreeRowCollapsed']?.forEach((fn) => fn(row, 0));
  return { handlers, holder, row, expand, collapse };
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

  it('leaves an existing selection where it is, and still takes focus back', () => {
    const selected = { select: jest.fn() } as unknown as RowComponent;
    const { row, holder, expand } = setup([selected]);

    expand();

    expect(row.select).not.toHaveBeenCalled();
    // The tree control drops focus, so the arrows would scroll the table.
    expect(holder.focus).toHaveBeenCalled();
  });

  it('takes focus back after a collapse, without selecting the closed row', () => {
    const { row, holder, collapse } = setup();

    collapse();

    expect(holder.focus).toHaveBeenCalled();
    // Selecting it would re-scope the inspector to the row just closed.
    expect(row.select).not.toHaveBeenCalled();
  });

  it('ignores a collapse the code drove', () => {
    const { holder, collapse } = setup();

    withCodeDrivenExpand(collapse);

    expect(holder.focus).not.toHaveBeenCalled();
  });

  it('ignores an expansion the code drove', () => {
    const { row, holder, expand } = setup();

    withCodeDrivenExpand(expand);

    expect(row.select).not.toHaveBeenCalled();
    expect(holder.focus).not.toHaveBeenCalled();
  });
});

describe('RowKeyboardNavigation key bindings', () => {
  const actions = RowKeyboardNavigation.moduleExtensions.keybindings.actions;

  /** A table of three rows with the middle one selected, as a key finds it. */
  function keyed({
    rowNav = true,
    dataTree = false,
    expanded = false,
  }: { rowNav?: boolean; dataTree?: boolean; expanded?: boolean } = {}) {
    const rowOf = (name: string) => {
      const scrollIntoView = jest.fn();
      return {
        name,
        scrollIntoView,
        select: jest.fn(),
        deselect: jest.fn(),
        getElement: () => ({ scrollIntoView }),
      };
    };
    const previous = rowOf('previous');
    const next = rowOf('next');
    const parent = rowOf('parent');
    const current = {
      ...rowOf('current'),
      getPrevRow: () => previous,
      getNextRow: () => next,
      getTreeParent: () => parent,
      isTreeExpanded: () => expanded,
      treeExpand: jest.fn(),
      treeCollapse: jest.fn(),
    };
    // The child of the selected row, which an expanded row steps into.
    Object.assign(next, { getTreeParent: () => current });
    const body = {};
    const table = {
      options: { rowKeyboardNavigation: rowNav, dataTree },
      element: { querySelector: () => body },
      getSelectedRows: () => [current],
    };
    const scope = { table } as unknown as never;
    const press = (action: keyof typeof actions, target: unknown = body) => {
      const event = { target, preventDefault: jest.fn() } as unknown as KeyboardEvent;
      actions[action].call(scope, event);
      return event;
    };
    return { previous, next, parent, current, body, press };
  }

  it('moves the selection down and keeps the row it lands on in view', () => {
    const { current, next, press } = keyed();

    const event = press('nextRow');

    expect(next.select).toHaveBeenCalled();
    expect(current.deselect).toHaveBeenCalled();
    expect(next.scrollIntoView).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('moves the selection up the same way', () => {
    const { previous, press } = keyed();

    press('previousRow');

    expect(previous.select).toHaveBeenCalled();
    expect(previous.scrollIntoView).toHaveBeenCalled();
  });

  it('takes no key where the table did not ask for row navigation', () => {
    const { next, press } = keyed({ rowNav: false });

    const event = press('nextRow');

    expect(next.select).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves a key from the tree control alone, which belongs to another row', () => {
    // The control carries its own tabIndex, so it can hold focus while a row
    // elsewhere is the selected one.
    const { current, next, press } = keyed({ dataTree: true });

    const event = press('nextRow', { control: true });
    press('expandRow', { control: true });

    expect(next.select).not.toHaveBeenCalled();
    expect(current.treeExpand).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('opens a closed tree row, and leaves a flat table alone', () => {
    const tree = keyed({ dataTree: true });
    tree.press('expandRow');
    expect(tree.current.treeExpand).toHaveBeenCalled();

    const flat = keyed();
    flat.press('expandRow');
    expect(flat.current.treeExpand).not.toHaveBeenCalled();
  });

  it('steps into the first child of a row already open', () => {
    const { next, press } = keyed({ dataTree: true, expanded: true });

    press('expandRow');

    expect(next.select).toHaveBeenCalled();
  });

  it('steps out to the parent of a closed row', () => {
    const { parent, press } = keyed({ dataTree: true });

    press('collapseRow');

    expect(parent.select).toHaveBeenCalled();
  });

  it('closes a row that is open, as the code rather than the user', () => {
    const { current, press } = keyed({ dataTree: true, expanded: true });

    press('collapseRow');

    expect(current.treeCollapse).toHaveBeenCalled();
  });
});
