/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { navFixture, navMaps, navNode, type NavName } from '#test-helpers/navTree.js';
import { TreeNavigator } from '../optimised/selection/TreeNavigator.js';
import type { EventNode, TreeNode } from '../types/flamechart.types.js';

type Step =
  | 'getParent'
  | 'getNextSibling'
  | 'getPrevSibling'
  | 'getNextAtDepth'
  | 'getPrevAtDepth'
  | 'getChildAtCenter';

function navigatorOver(roots: TreeNode<EventNode>[]): TreeNavigator {
  return new TreeNavigator(roots, navMaps(roots));
}

describe('TreeNavigator', () => {
  const { roots, maps, nodes } = navFixture();
  const navigator = new TreeNavigator(roots, maps);

  it.each<[Step, NavName, NavName | null]>([
    ['getParent', 'a', null],
    ['getParent', 'c', 'a'],
    ['getParent', 'g', 'c'],
    ['getNextSibling', 'c', 'd'],
    ['getNextSibling', 'a', 'b'],
    ['getNextSibling', 'b', null],
    // A sibling stays under one parent, whoever sits next at the depth.
    ['getNextSibling', 'd', null],
    ['getNextSibling', 'g', null],
    ['getPrevSibling', 'd', 'c'],
    ['getPrevSibling', 'b', 'a'],
    ['getPrevSibling', 'a', null],
    ['getPrevSibling', 'e', null],
    ['getPrevSibling', 'g', null],
    ['getNextAtDepth', 'd', 'e'],
    ['getNextAtDepth', 'e', 'f'],
    ['getNextAtDepth', 'a', 'b'],
    ['getNextAtDepth', 'f', null],
    ['getNextAtDepth', 'g', null],
    ['getPrevAtDepth', 'e', 'd'],
    ['getPrevAtDepth', 'd', 'c'],
    ['getPrevAtDepth', 'b', 'a'],
    ['getPrevAtDepth', 'c', null],
    // a's centre (100) is d's start; c's range ends there, exclusive.
    ['getChildAtCenter', 'a', 'd'],
    ['getChildAtCenter', 'b', 'f'],
    ['getChildAtCenter', 'c', 'g'],
    ['getChildAtCenter', 'g', null],
  ])('%s(%s) is %s', (step, from, expected) => {
    expect(navigator[step](nodes[from])).toBe(expected ? nodes[expected] : null);
  });

  it.each<[string, NavName | null]>([
    ['a', 'a'],
    ['g', 'g'],
    ['999', null],
  ])('findById(%s) is %s', (id, expected) => {
    expect(navigator.findById(id)).toBe(expected ? nodes[expected] : null);
  });

  it('finds a node by the parsed event it was built from', () => {
    expect(navigator.findByOriginal(nodes.e.data.original)).toBe(nodes.e);
    expect(navigator.findByOriginal({})).toBeNull();
  });

  it('takes the child closest to the centre when none spans it', () => {
    const near = navNode('near', 80, 10, 1);
    const parent = navNode('p', 0, 100, 0, [navNode('far', 0, 10, 1), near]);

    expect(navigatorOver([parent]).getChildAtCenter(parent)).toBe(near);
  });

  it('steps past a frame that starts before the current one ends', () => {
    // Should not happen in a log, but the step is to the first frame starting after this one ends.
    const a = navNode('a', 0, 100, 0);
    const b = navNode('b', 50, 100, 0);
    const c = navNode('c', 150, 100, 0);

    expect(navigatorOver([a, b, c]).getNextAtDepth(a)).toBe(c);
  });

  it('finds nothing in an empty tree', () => {
    expect(navigatorOver([]).findById('a')).toBeNull();
  });
});
