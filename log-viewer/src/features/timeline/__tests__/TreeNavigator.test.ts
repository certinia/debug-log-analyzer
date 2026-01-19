/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TreeNavigator
 *
 * Tests tree navigation functionality for flame chart selection:
 * - Parent traversal (Arrow Up)
 * - Child traversal (Arrow Down - first child)
 * - Sibling traversal (Arrow Left/Right)
 * - Edge cases: root nodes, leaf nodes, only-child scenarios
 */

import { TreeNavigator } from '../optimised/selection/TreeNavigator.js';
import type { EventNode, TreeNode } from '../types/flamechart.types.js';

describe('TreeNavigator', () => {
  /**
   * Helper to create a mock EventNode
   */
  function createEvent(id: string, text: string = `Event ${id}`): EventNode {
    return {
      id,
      timestamp: parseInt(id) * 1000,
      duration: 1000,
      type: 'METHOD_ENTRY',
      text,
    };
  }

  /**
   * Helper to create a TreeNode wrapping an EventNode
   */
  function createNode(
    event: EventNode,
    children?: TreeNode<EventNode>[],
    depth = 0,
  ): TreeNode<EventNode> {
    return {
      data: event,
      children,
      depth,
    };
  }

  describe('basic tree structure', () => {
    // Tree structure:
    //   root1 (id: 1)
    //     ├── child1 (id: 11)
    //     │   └── grandchild1 (id: 111)
    //     └── child2 (id: 12)
    //   root2 (id: 2)

    let navigator: TreeNavigator;
    let root1: TreeNode<EventNode>;
    let root2: TreeNode<EventNode>;
    let child1: TreeNode<EventNode>;
    let child2: TreeNode<EventNode>;
    let grandchild1: TreeNode<EventNode>;

    beforeEach(() => {
      grandchild1 = createNode(createEvent('111'), undefined, 2);
      child1 = createNode(createEvent('11'), [grandchild1], 1);
      child2 = createNode(createEvent('12'), undefined, 1);
      root1 = createNode(createEvent('1'), [child1, child2], 0);
      root2 = createNode(createEvent('2'), undefined, 0);

      navigator = new TreeNavigator([root1, root2]);
    });

    describe('findById', () => {
      it('should find root nodes by id', () => {
        expect(navigator.findById('1')).toBe(root1);
        expect(navigator.findById('2')).toBe(root2);
      });

      it('should find child nodes by id', () => {
        expect(navigator.findById('11')).toBe(child1);
        expect(navigator.findById('12')).toBe(child2);
      });

      it('should find deeply nested nodes by id', () => {
        expect(navigator.findById('111')).toBe(grandchild1);
      });

      it('should return null for non-existent id', () => {
        expect(navigator.findById('999')).toBeNull();
      });
    });

    describe('getParent', () => {
      it('should return null for root nodes', () => {
        expect(navigator.getParent(root1)).toBeNull();
        expect(navigator.getParent(root2)).toBeNull();
      });

      it('should return parent for child nodes', () => {
        expect(navigator.getParent(child1)).toBe(root1);
        expect(navigator.getParent(child2)).toBe(root1);
      });

      it('should return parent for deeply nested nodes', () => {
        expect(navigator.getParent(grandchild1)).toBe(child1);
      });
    });

    describe('getFirstChild', () => {
      it('should return first child for parent nodes', () => {
        expect(navigator.getFirstChild(root1)).toBe(child1);
        expect(navigator.getFirstChild(child1)).toBe(grandchild1);
      });

      it('should return null for leaf nodes', () => {
        expect(navigator.getFirstChild(root2)).toBeNull();
        expect(navigator.getFirstChild(child2)).toBeNull();
        expect(navigator.getFirstChild(grandchild1)).toBeNull();
      });
    });

    describe('getNextSibling', () => {
      it('should return next sibling', () => {
        expect(navigator.getNextSibling(child1)).toBe(child2);
      });

      it('should return null for last sibling', () => {
        expect(navigator.getNextSibling(child2)).toBeNull();
      });

      it('should return next root sibling', () => {
        expect(navigator.getNextSibling(root1)).toBe(root2);
      });

      it('should return null for last root sibling', () => {
        expect(navigator.getNextSibling(root2)).toBeNull();
      });

      it('should return null for only child', () => {
        expect(navigator.getNextSibling(grandchild1)).toBeNull();
      });
    });

    describe('getPrevSibling', () => {
      it('should return previous sibling', () => {
        expect(navigator.getPrevSibling(child2)).toBe(child1);
      });

      it('should return null for first sibling', () => {
        expect(navigator.getPrevSibling(child1)).toBeNull();
      });

      it('should return previous root sibling', () => {
        expect(navigator.getPrevSibling(root2)).toBe(root1);
      });

      it('should return null for first root sibling', () => {
        expect(navigator.getPrevSibling(root1)).toBeNull();
      });

      it('should return null for only child', () => {
        expect(navigator.getPrevSibling(grandchild1)).toBeNull();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty tree', () => {
      const navigator = new TreeNavigator([]);

      expect(navigator.findById('1')).toBeNull();
    });

    it('should handle single node tree', () => {
      const singleNode = createNode(createEvent('1'));
      const navigator = new TreeNavigator([singleNode]);

      expect(navigator.findById('1')).toBe(singleNode);
      expect(navigator.getParent(singleNode)).toBeNull();
      expect(navigator.getFirstChild(singleNode)).toBeNull();
      expect(navigator.getNextSibling(singleNode)).toBeNull();
      expect(navigator.getPrevSibling(singleNode)).toBeNull();
    });

    it('should handle nodes with empty children array', () => {
      const nodeWithEmptyChildren = createNode(createEvent('1'), []);
      const navigator = new TreeNavigator([nodeWithEmptyChildren]);

      expect(navigator.getFirstChild(nodeWithEmptyChildren)).toBeNull();
    });

    it('should handle deep nesting', () => {
      // Create a deep chain: 1 -> 2 -> 3 -> 4 -> 5
      const level5 = createNode(createEvent('5'), undefined, 4);
      const level4 = createNode(createEvent('4'), [level5], 3);
      const level3 = createNode(createEvent('3'), [level4], 2);
      const level2 = createNode(createEvent('2'), [level3], 1);
      const level1 = createNode(createEvent('1'), [level2], 0);

      const navigator = new TreeNavigator([level1]);

      // Navigate down
      expect(navigator.getFirstChild(level1)).toBe(level2);
      expect(navigator.getFirstChild(level2)).toBe(level3);
      expect(navigator.getFirstChild(level3)).toBe(level4);
      expect(navigator.getFirstChild(level4)).toBe(level5);
      expect(navigator.getFirstChild(level5)).toBeNull();

      // Navigate up
      expect(navigator.getParent(level5)).toBe(level4);
      expect(navigator.getParent(level4)).toBe(level3);
      expect(navigator.getParent(level3)).toBe(level2);
      expect(navigator.getParent(level2)).toBe(level1);
      expect(navigator.getParent(level1)).toBeNull();
    });

    it('should handle multiple siblings at same level', () => {
      const sibling1 = createNode(createEvent('1'));
      const sibling2 = createNode(createEvent('2'));
      const sibling3 = createNode(createEvent('3'));
      const sibling4 = createNode(createEvent('4'));

      const navigator = new TreeNavigator([sibling1, sibling2, sibling3, sibling4]);

      // Forward traversal
      expect(navigator.getNextSibling(sibling1)).toBe(sibling2);
      expect(navigator.getNextSibling(sibling2)).toBe(sibling3);
      expect(navigator.getNextSibling(sibling3)).toBe(sibling4);
      expect(navigator.getNextSibling(sibling4)).toBeNull();

      // Backward traversal
      expect(navigator.getPrevSibling(sibling4)).toBe(sibling3);
      expect(navigator.getPrevSibling(sibling3)).toBe(sibling2);
      expect(navigator.getPrevSibling(sibling2)).toBe(sibling1);
      expect(navigator.getPrevSibling(sibling1)).toBeNull();
    });
  });

  describe('complex tree scenarios', () => {
    it('should handle asymmetric tree', () => {
      // Tree structure:
      //   a
      //     ├── b
      //     │   ├── d
      //     │   │   └── g
      //     │   └── e
      //     └── c
      //         └── f

      const g = createNode(createEvent('g'), undefined, 3);
      const d = createNode(createEvent('d'), [g], 2);
      const e = createNode(createEvent('e'), undefined, 2);
      const f = createNode(createEvent('f'), undefined, 2);
      const b = createNode(createEvent('b'), [d, e], 1);
      const c = createNode(createEvent('c'), [f], 1);
      const a = createNode(createEvent('a'), [b, c], 0);

      const navigator = new TreeNavigator([a]);

      // Siblings at different levels
      expect(navigator.getNextSibling(d)).toBe(e);
      expect(navigator.getPrevSibling(e)).toBe(d);
      expect(navigator.getNextSibling(e)).toBeNull();

      // f is only child
      expect(navigator.getNextSibling(f)).toBeNull();
      expect(navigator.getPrevSibling(f)).toBeNull();

      // Cross-branch - siblings should only be in same parent
      expect(navigator.getNextSibling(b)).toBe(c);
      expect(navigator.getPrevSibling(c)).toBe(b);
    });
  });
});
