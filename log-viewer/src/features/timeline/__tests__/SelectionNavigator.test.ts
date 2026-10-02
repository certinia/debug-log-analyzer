/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { navFixture, navMaps, type NavName } from '#test-helpers/navTree.js';
import type { FrameNavDirection } from '../optimised/interaction/KeyboardHandler.js';
import { SelectionNavigator } from '../optimised/selection/SelectionNavigator.js';
import type { EventNode } from '../types/flamechart.types.js';

describe('SelectionNavigator', () => {
  let nodes: ReturnType<typeof navFixture>['nodes'];
  let manager: SelectionNavigator<EventNode>;

  beforeEach(() => {
    const fixture = navFixture();
    nodes = fixture.nodes;
    manager = new SelectionNavigator(fixture.roots, fixture.maps);
  });

  it('selects a node, and replaces the selection with the next one', () => {
    expect(manager.getSelected()).toBeNull();
    expect(manager.hasSelection()).toBe(false);

    manager.select(nodes.a);
    manager.select(nodes.b);

    expect(manager.getSelected()).toBe(nodes.b);
    expect(manager.hasSelection()).toBe(true);
  });

  it('clears the selection, and clears nothing safely', () => {
    manager.clear();
    manager.select(nodes.a);
    manager.clear();

    expect(manager.getSelected()).toBeNull();
    expect(manager.hasSelection()).toBe(false);
  });

  it.each<FrameNavDirection>(['up', 'down', 'left', 'right'])(
    'goes nowhere %s with nothing selected',
    (direction) => {
      expect(manager.navigate(direction)).toBeNull();
    },
  );

  it.each<[FrameNavDirection, NavName, NavName | null]>([
    ['up', 'a', 'd'],
    ['up', 'c', 'g'],
    ['up', 'g', null],
    ['down', 'g', 'c'],
    ['down', 'a', null],
    ['left', 'd', 'c'],
    ['left', 'b', 'a'],
    ['left', 'e', 'd'],
    ['left', 'c', null],
    ['right', 'c', 'd'],
    ['right', 'a', 'b'],
    ['right', 'd', 'e'],
    ['right', 'f', null],
  ])('navigates %s from %s to %s', (direction, from, expected) => {
    manager.select(nodes[from]);

    const result = manager.navigate(direction);

    expect(result).toBe(expected ? nodes[expected] : null);
    expect(manager.getSelected()).toBe(nodes[expected ?? from]);
  });

  it('finds a node by id', () => {
    expect(manager.findById('g')).toBe(nodes.g);
    expect(manager.findById('999')).toBeNull();
  });

  it('maps a hit-test frame back to its node through the parsed event', () => {
    expect(manager.findByOriginal({ ...nodes.e.data })).toBe(nodes.e);
    expect(manager.findByOriginal({ ...nodes.e.data, original: undefined })).toBeNull();
  });

  it('handles an empty tree', () => {
    const empty = new SelectionNavigator<EventNode>([], navMaps([]));

    expect(empty.hasSelection()).toBe(false);
    expect(empty.findById('a')).toBeNull();
  });
});
