/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fakeHost } from '#test-helpers/fakeHost.js';
import { HoverIntentController } from '../components/HoverIntentController.js';

function setup() {
  const shown: (string | null)[] = [];
  const host = fakeHost();
  const intent = new HoverIntentController<string>(host, (item) => shown.push(item));
  return { host, intent, shown };
}

describe('HoverIntentController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows nothing for a pointer passing over', () => {
    const { intent, shown } = setup();

    intent.enter('SOQL');
    jest.advanceTimersByTime(100);
    intent.leave();
    jest.runAllTimers();

    expect(shown).toEqual([]);
  });

  it('shows an item once the pointer rests on it', () => {
    const { intent, shown } = setup();

    intent.enter('SOQL');
    jest.advanceTimersByTime(150);

    expect(shown).toEqual(['SOQL']);
  });

  it('moves to a neighbour at once, with no flash between them', () => {
    const { intent, shown } = setup();
    intent.enter('SOQL');
    jest.advanceTimersByTime(150);

    intent.leave();
    jest.advanceTimersByTime(50);
    intent.enter('DML');

    expect(shown).toEqual(['SOQL', 'DML']);
  });

  it('drops the preview a moment after the pointer leaves the row', () => {
    const { intent, shown } = setup();
    intent.enter('SOQL');
    jest.advanceTimersByTime(150);

    intent.leave();
    jest.advanceTimersByTime(100);

    expect(shown).toEqual(['SOQL', null]);
  });

  it('waits again once the row has cooled down', () => {
    const { intent, shown } = setup();
    intent.enter('SOQL');
    jest.advanceTimersByTime(150);
    intent.leave();
    jest.advanceTimersByTime(100);

    intent.enter('DML');

    expect(shown).toEqual(['SOQL', null]);
  });

  it('shows keyboard focus at once', () => {
    const { intent, shown } = setup();

    intent.focus('Apex');

    expect(shown).toEqual(['Apex']);
  });

  it('returns to the focused item when the pointer leaves another', () => {
    const { intent, shown } = setup();
    intent.focus('Apex');
    intent.enter('SOQL');

    intent.leave();
    jest.advanceTimersByTime(100);

    expect(shown).toEqual(['Apex', 'SOQL', 'Apex']);
  });

  it('keeps the focused item shown when a pointer passes over nothing else', () => {
    const { intent, shown } = setup();
    intent.focus('Apex');

    intent.leave();
    jest.runAllTimers();

    expect(shown).toEqual(['Apex']);
  });

  it('drops the preview once focus leaves', () => {
    const { intent, shown } = setup();
    intent.focus('Apex');

    intent.blur();
    jest.advanceTimersByTime(100);

    expect(shown).toEqual(['Apex', null]);
  });

  it('forgets a pending preview when the host disconnects', () => {
    const { host, intent, shown } = setup();

    intent.enter('SOQL');
    host.disconnect();
    jest.runAllTimers();

    expect(shown).toEqual([]);
  });

  it('drops a preview on screen when the host disconnects', () => {
    const { host, intent, shown } = setup();

    intent.focus('SOQL');
    host.disconnect();

    expect(shown).toEqual(['SOQL', null]);
  });
});
