/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for SelectionManager
 *
 * Tests selection state management and navigation:
 * - select/clear/getSelected lifecycle
 * - hasSelection state tracking
 * - navigate() for all directions
 * - findByOriginal for hit test integration
 */

import { SelectionManager } from '../optimised/selection/SelectionManager.js';
import type { EventNode, TreeNode } from '../types/flamechart.types.js';

describe('SelectionManager', () => {
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

  describe('selection lifecycle', () => {
    let manager: SelectionManager<EventNode>;
    let node1: TreeNode<EventNode>;
    let node2: TreeNode<EventNode>;

    beforeEach(() => {
      node1 = createNode(createEvent('1'));
      node2 = createNode(createEvent('2'));
      manager = new SelectionManager([node1, node2]);
    });

    it('should have no selection initially', () => {
      expect(manager.getSelected()).toBeNull();
      expect(manager.hasSelection()).toBe(false);
    });

    it('should select a node', () => {
      manager.select(node1);

      expect(manager.getSelected()).toBe(node1);
      expect(manager.hasSelection()).toBe(true);
    });

    it('should change selection when selecting different node', () => {
      manager.select(node1);
      manager.select(node2);

      expect(manager.getSelected()).toBe(node2);
      expect(manager.hasSelection()).toBe(true);
    });

    it('should clear selection', () => {
      manager.select(node1);
      manager.clear();

      expect(manager.getSelected()).toBeNull();
      expect(manager.hasSelection()).toBe(false);
    });

    it('should handle clearing when nothing is selected', () => {
      manager.clear(); // Should not throw

      expect(manager.getSelected()).toBeNull();
      expect(manager.hasSelection()).toBe(false);
    });
  });

  describe('navigation', () => {
    // Tree structure:
    //   root1 (id: 1)
    //     ├── child1 (id: 11)
    //     │   └── grandchild1 (id: 111)
    //     └── child2 (id: 12)
    //   root2 (id: 2)

    let manager: SelectionManager<EventNode>;
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

      manager = new SelectionManager([root1, root2]);
    });

    it('should return null when navigating with no selection', () => {
      expect(manager.navigate('up')).toBeNull();
      expect(manager.navigate('down')).toBeNull();
      expect(manager.navigate('left')).toBeNull();
      expect(manager.navigate('right')).toBeNull();
    });

    describe('navigate up (into children)', () => {
      it('should navigate up to first child', () => {
        manager.select(root1);
        const result = manager.navigate('up');

        expect(result).toBe(child1);
        expect(manager.getSelected()).toBe(child1);
      });

      it('should navigate up to grandchild', () => {
        manager.select(child1);
        const result = manager.navigate('up');

        expect(result).toBe(grandchild1);
        expect(manager.getSelected()).toBe(grandchild1);
      });

      it('should return null at leaf node', () => {
        manager.select(grandchild1);
        const result = manager.navigate('up');

        expect(result).toBeNull();
        expect(manager.getSelected()).toBe(grandchild1); // Selection unchanged
      });
    });

    describe('navigate down (to parent)', () => {
      it('should navigate down to parent', () => {
        manager.select(child1);
        const result = manager.navigate('down');

        expect(result).toBe(root1);
        expect(manager.getSelected()).toBe(root1);
      });

      it('should return null at root', () => {
        manager.select(root1);
        const result = manager.navigate('down');

        expect(result).toBeNull();
        expect(manager.getSelected()).toBe(root1); // Selection unchanged
      });
    });

    describe('navigate left (previous sibling)', () => {
      it('should navigate left to previous sibling', () => {
        manager.select(child2);
        const result = manager.navigate('left');

        expect(result).toBe(child1);
        expect(manager.getSelected()).toBe(child1);
      });

      it('should navigate left between root siblings', () => {
        manager.select(root2);
        const result = manager.navigate('left');

        expect(result).toBe(root1);
        expect(manager.getSelected()).toBe(root1);
      });

      it('should return null at first sibling', () => {
        manager.select(child1);
        const result = manager.navigate('left');

        expect(result).toBeNull();
        expect(manager.getSelected()).toBe(child1); // Selection unchanged
      });
    });

    describe('navigate right (next sibling)', () => {
      it('should navigate right to next sibling', () => {
        manager.select(child1);
        const result = manager.navigate('right');

        expect(result).toBe(child2);
        expect(manager.getSelected()).toBe(child2);
      });

      it('should navigate right between root siblings', () => {
        manager.select(root1);
        const result = manager.navigate('right');

        expect(result).toBe(root2);
        expect(manager.getSelected()).toBe(root2);
      });

      it('should return null at last sibling', () => {
        manager.select(child2);
        const result = manager.navigate('right');

        expect(result).toBeNull();
        expect(manager.getSelected()).toBe(child2); // Selection unchanged
      });
    });
  });

  describe('findById', () => {
    let manager: SelectionManager<EventNode>;
    let node1: TreeNode<EventNode>;
    let node2: TreeNode<EventNode>;

    beforeEach(() => {
      const child = createNode(createEvent('11'), undefined, 1);
      node1 = createNode(createEvent('1'), [child], 0);
      node2 = createNode(createEvent('2'), undefined, 0);
      manager = new SelectionManager([node1, node2]);
    });

    it('should find node by id', () => {
      expect(manager.findById('1')).toBe(node1);
      expect(manager.findById('2')).toBe(node2);
    });

    it('should find nested node by id', () => {
      const found = manager.findById('11');
      expect(found).not.toBeNull();
      expect(found?.data.id).toBe('11');
    });

    it('should return null for non-existent id', () => {
      expect(manager.findById('999')).toBeNull();
    });
  });

  describe('empty tree', () => {
    it('should handle empty tree', () => {
      const manager = new SelectionManager<EventNode>([]);

      expect(manager.hasSelection()).toBe(false);
      expect(manager.getSelected()).toBeNull();
      expect(manager.findById('1')).toBeNull();
    });
  });
});
