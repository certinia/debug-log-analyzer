/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * A slimmed down multiset (bag) data structure that allows duplicate elements and tracks their count.
 * Provides O(1) add, remove, and has operations.
 * Note: This could easily be extended to a full multiset implementation and count() function etc if needed in the future.
 */
export class Multiset<T> {
  private map: Map<T, number> = new Map();

  /**
   * Adds an element to the multiset.
   * @param element - The element to add
   * @returns The new count of this element
   */
  add(element: T): number {
    const count = (this.map.get(element) ?? 0) + 1;
    this.map.set(element, count);
    return count;
  }

  /**
   * Removes one occurrence of an element from the multiset.
   * @param element - The element to remove
   * @returns True if an element was removed, false if element was not in the multiset
   */
  remove(element: T): boolean {
    const count = this.map.get(element);
    if (count === undefined) {
      return false;
    }

    if (count === 1) {
      this.map.delete(element);
    } else {
      this.map.set(element, count - 1);
    }
    return true;
  }

  /**
   * Checks if the multiset contains at least one occurrence of an element.
   * @param element - The element to check
   * @returns True if the element is in the multiset
   */
  has(element: T): boolean {
    return this.map.has(element);
  }
}
