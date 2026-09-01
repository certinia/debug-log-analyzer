/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

// The tabulator ESM build doesn't load under jest, and the module registers
// itself on import.
jest.mock('tabulator-tables', () => ({
  Module: class {
    table: unknown;
    constructor(table: unknown) {
      this.table = table;
    }
    registerTableOption() {}
    registerTableFunction() {}
    subscribe() {}
  },
}));

import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';
import { Find } from '../Find.js';

function setup() {
  const subscribed: Record<string, (() => void)[]> = {};
  const listened: string[] = [];
  const tableEvents: Record<string, (() => void)[]> = {};
  const table = {
    on: (event: string, callback: () => void) => {
      (tableEvents[event] ??= []).push(callback);
    },
    element: {
      querySelector: () => ({
        addEventListener: (event: string) => {
          listened.push(event);
        },
      }),
    },
  };
  const find = new Find(table as never);
  find.subscribe = (event: string, callback: () => void) => {
    (subscribed[event] ??= []).push(callback);
  };
  find.initialize();

  const applied = jest.fn();
  find._applyHighlights = applied;
  const attach = () => subscribed['render-virtual-attach']?.forEach((fn) => fn());
  const scroll = () => tableEvents['scrollVertical']?.forEach((fn) => fn());
  const nextFrame = waitForNextFrame;
  return { find, applied, attach, scroll, nextFrame, listened };
}

describe('Find highlights on the rows a render attaches', () => {
  it('re-applies once for the frame, however many attaches it took', async () => {
    const { find, applied, attach, nextFrame } = setup();
    find._findArgs = { text: 'a', count: 0, options: { matchCase: false } };

    attach();
    attach();
    expect(applied).not.toHaveBeenCalled();
    await nextFrame();

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('leaves the rows alone while nothing is being searched for', async () => {
    const { applied, attach, nextFrame } = setup();

    attach();
    await nextFrame();

    expect(applied).not.toHaveBeenCalled();
  });

  it("re-applies on a scroll, which is all a grid on Tabulator's renderer reports", async () => {
    const { find, applied, scroll, nextFrame } = setup();
    find._findArgs = { text: 'a', count: 0, options: { matchCase: false } };

    scroll();
    await nextFrame();

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('takes the scroll from the table, not from the holder element', () => {
    // Tabulator reports it for every renderer, and the holder is rebuilt.
    const { listened } = setup();

    expect(listened).toEqual([]);
  });
});
