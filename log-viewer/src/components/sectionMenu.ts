/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ContextMenuItem } from './ContextMenu.js';
import type { PaneSection } from './PaneView.js';

/** The reset row. Every other row names a section, behind {@link SECTION_PREFIX}. */
export const RESET_SECTIONS_ID = 'reset-sections';
const SECTION_PREFIX = 'section:';

/** The section a menu row names, or null for any other row. */
export function sectionIdFor(itemId: string): string | null {
  return itemId.startsWith(SECTION_PREFIX) ? itemId.slice(SECTION_PREFIX.length) : null;
}

/**
 * The section header's menu: reset this list, then a row per section, ticked
 * while it shows.
 *
 * The last section still showing cannot be unticked. Hiding it would leave no
 * header to right-click, and so no way back to this menu.
 */
export function buildSectionMenuItems(
  sections: PaneSection[],
  hidden: ReadonlySet<string>,
): ContextMenuItem[] {
  const showing = sections.filter((section) => !hidden.has(section.id)).length;
  return [
    { id: RESET_SECTIONS_ID, label: 'Reset Sections' },
    { id: 'section-sep', label: '', separator: true },
    ...sections.map((section) => {
      const shows = !hidden.has(section.id);
      return {
        id: `${SECTION_PREFIX}${section.id}`,
        label: section.title,
        checked: shows,
        keepOpen: true,
        disabled: showing === 1 && shows,
      };
    }),
  ];
}
