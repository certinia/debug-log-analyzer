/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import { eventBus } from '../../core/events/EventBus.js';
import { InspectorEmphasis } from '../inspectorEmphasis.js';
import { wireInspectorTab } from '../inspectorTab.js';

describe('wireInspectorTab', () => {
  let off: (() => void) | null = null;

  afterEach(() => {
    off?.();
    off = null;
  });

  /** A Call Tree-like view: it records what it marked, moved to and cleared. */
  function wire(
    movesToMergedPick = true,
    reveal?: (eventIndex: number, signal: AbortSignal) => Promise<void>,
  ) {
    const marks: Array<readonly number[]> = [];
    const revealed: number[] = [];
    /** The signal each move was given, so a test can read which were abandoned. */
    const signals: AbortSignal[] = [];
    /** Marks and moves in the order they arrived, which the two lists cannot show. */
    const order: string[] = [];
    let clears = 0;
    off = wireInspectorTab('calltree', new InspectorEmphasis(), {
      mark: (eventIndexes) => {
        marks.push(eventIndexes);
        order.push('mark');
      },
      reveal: (eventIndex, signal) => {
        order.push('move');
        signals.push(signal);
        if (reveal) {
          return reveal(eventIndex, signal);
        }
        revealed.push(eventIndex);
      },
      clear: () => {
        clears++;
      },
      movesToMergedPick,
    });
    return { marks, revealed, order, signals, clears: () => clears };
  }

  it('leaves an event for another tab alone', () => {
    const view = wire();

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [4], sticky: true });
    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: 4 });
    eventBus.emit('selection:clear', { source: 'analysis' });

    expect(view.marks).toEqual([]);
    expect(view.revealed).toEqual([]);
    expect(view.clears()).toBe(0);
  });

  it('marks under the pointer without moving the view', () => {
    const view = wire();

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4, 5], sticky: false });

    expect(view.marks).toEqual([[4, 5]]);
    expect(view.revealed).toEqual([]);
  });

  it('marks a picked row and moves to the first of its occurrences', () => {
    const view = wire();

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4, 5], sticky: true });

    expect(view.marks).toEqual([[4, 5]]);
    expect(view.revealed).toEqual([4]);
    // The mark goes on first: a row the move renders lights itself from it.
    expect(view.order).toEqual(['mark', 'move']);
  });

  it('only marks a picked row where moving to one occurrence would be arbitrary', () => {
    const view = wire(false);

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4, 5], sticky: true });

    expect(view.marks).toEqual([[4, 5]]);
    expect(view.revealed).toEqual([]);
  });

  it('moves to the one frame a single-frame pick names, wherever the mark is', () => {
    const view = wire(false);

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 7 });

    expect(view.revealed).toEqual([7]);
  });

  it('clears the mark when the pick is dropped', () => {
    const view = wire();

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4], sticky: true });
    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [], sticky: true });

    expect(view.marks.at(-1)).toEqual([]);
    // Nothing to move to, so the view is left where the user put it.
    expect(view.revealed).toEqual([4]);
  });

  it('drops the view selection and the mark on an app-wide clear', () => {
    const view = wire();

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4], sticky: true });
    eventBus.emit('selection:clear', { source: 'calltree' });

    expect(view.clears()).toBe(1);
    expect(view.marks.at(-1)).toEqual([]);
  });

  it('keeps the mark where the view cannot move', async () => {
    const view = wire(true, () => Promise.reject(new Error('no row for it')));

    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4], sticky: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.marks).toEqual([[4]]);
  });

  it('abandons a move the next one replaces, and keeps both marks', () => {
    const view = wire();

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 4 });
    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [9], sticky: true });

    // The pointer crossing rows asks for a move per row, and the one it stops on
    // is the one that scrolls.
    expect(view.signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(view.marks).toEqual([[9]]);
  });

  it('abandons the move in flight when the view goes away', () => {
    const view = wire();

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 4 });
    off?.();
    off = null;

    expect(view.signals[0]?.aborted).toBe(true);
  });

  it('stops answering once unsubscribed', () => {
    const view = wire();

    off?.();
    off = null;
    eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [4], sticky: true });
    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: 4 });
    eventBus.emit('selection:clear', { source: 'calltree' });

    expect(view.marks).toEqual([]);
    expect(view.revealed).toEqual([]);
    expect(view.clears()).toBe(0);
  });
});
