/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../core/events/EventBus.js';
import { InspectorTabController } from '../InspectorTabController.js';
import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';

/** Every mark the view was asked for, in order. */
let marked: readonly number[][] = [];

function controllerFor(host: FakeHost): InspectorTabController {
  return new InspectorTabController(host, 'analysis', {
    mark: (eventIndexes) => {
      marked = [...marked, [...eventIndexes]];
    },
    reveal: () => {},
    clear: () => {},
  });
}

describe('InspectorTabController', () => {
  let host: FakeHost;
  let inspector: InspectorTabController;

  beforeEach(() => {
    marked = [];
    host = fakeHost();
    inspector = controllerFor(host);
  });

  // The bus outlives the host, so a test that connects has to let go.
  afterEach(() => {
    host.disconnect();
  });

  it('hears nothing until the host connects', () => {
    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [1], sticky: false });

    expect(marked).toEqual([]);
  });

  it('drops a pick the view no longer holds a selection for', () => {
    host.connect();
    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [3], sticky: true });

    inspector.dropPick();

    expect(marked).toEqual([[3], []]);
  });

  it('stops at a detach and hears again after a re-attach', () => {
    host.connect();
    host.disconnect();

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [1], sticky: false });
    expect(marked).toEqual([]);

    host.connect();
    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [1], sticky: false });

    expect(marked).toEqual([[1]]);
  });

  it('lights a pick again for a view that comes back', () => {
    host.connect();
    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [3], sticky: true });
    host.disconnect();
    marked = [];

    host.connect();

    // The inspector still shows the row picked, so the view has to show it too.
    expect(marked).toEqual([[3]]);
  });

  it('marks nothing for a view connecting with no pick to show', () => {
    host.connect();

    expect(marked).toEqual([]);
  });
});
