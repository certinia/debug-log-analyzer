/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Where the metric strip's pointer counts as on its collapse chevron.
 * Kept apart from the orchestrator so the rule can be read and tested on its own.
 */

/** Chevron left padding in pixels */
const TOGGLE_ICON_PADDING_X = 6;
/** Chevron top padding in pixels */
const TOGGLE_ICON_PADDING_Y = 2.5;
/** Chevron arm length in pixels */
const TOGGLE_ICON_SIZE = 5;

/** How far outside the chevron still counts as over it, in pixels. */
const CHEVRON_HIT_PAD = 3;

/** A box on the strip, in strip coordinates. */
export interface StripBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The collapse chevron's box: ▶ when collapsed, ▼ when expanded.
 *
 * The one source for the arrow — the renderer draws inside this box and the hit test reads
 * it, so a change to the glyph cannot leave the two disagreeing.
 *
 * @param isCollapsed - Which arrow is drawn
 */
export function chevronBox(isCollapsed: boolean): StripBox {
  return {
    x: TOGGLE_ICON_PADDING_X,
    y: TOGGLE_ICON_PADDING_Y,
    width: isCollapsed ? TOGGLE_ICON_SIZE : TOGGLE_ICON_SIZE * 2,
    height: isCollapsed ? TOGGLE_ICON_SIZE * 2 : TOGGLE_ICON_SIZE,
  };
}

/**
 * Whether the pointer is over the collapse chevron.
 *
 * The arrow, not the 20px column it sits in: the column is a forgiving click target, but
 * hovering it must not blank the tooltip four times wider than the arrow drawn.
 *
 * @param offsetX - Pointer X relative to the strip's left edge
 * @param offsetY - Pointer Y relative to the strip's top edge
 * @param isCollapsed - Which arrow is drawn
 */
export function isOverChevron(offsetX: number, offsetY: number, isCollapsed: boolean): boolean {
  const box = chevronBox(isCollapsed);

  return (
    offsetX >= box.x - CHEVRON_HIT_PAD &&
    offsetX <= box.x + box.width + CHEVRON_HIT_PAD &&
    offsetY >= box.y - CHEVRON_HIT_PAD &&
    offsetY <= box.y + box.height + CHEVRON_HIT_PAD
  );
}
