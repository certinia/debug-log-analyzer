/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { eventBus, type DetailSource } from '../../core/events/EventBus.js';

/**
 * Decides whether an Escape keydown may clear the active tab's selection.
 * Anything else that wants Escape has priority: a handler that already
 * consumed the key (`preventDefault` — the timeline's own Escape cascade, the
 * context menu), an editable element with focus (the find widget, grid header
 * filters) or an open popover (menus, dropdowns) in the composed path.
 */
export function isDeselectEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) {
    return false;
  }
  return !event
    .composedPath()
    .some((el) => el instanceof Element && (isEditable(el) || involvesOpenPopover(el)));
}

/**
 * Installs the app-wide Escape-to-deselect handling on `document` (bubble
 * phase, so capture-phase consumers such as the context menu run first). An
 * unconsumed Escape asks the active tab's view to drop its selection; the
 * view's own selection-change path then clears the inspector.
 * Returns the uninstall function.
 */
export function installEscapeDeselect(activeSource: () => DetailSource | undefined): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isDeselectEscape(event)) {
      return;
    }
    const source = activeSource();
    if (source) {
      eventBus.emit('selection:clear', { source });
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

/** Text entry keeps Escape (e.g. the find widget closes itself). */
function isEditable(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** An open popover, or the button that toggles one, keeps Escape (light dismiss). */
function involvesOpenPopover(el: Element): boolean {
  if (el.hasAttribute('popover') && isPopoverOpen(el)) {
    return true;
  }
  const targetId = el.getAttribute('popovertarget');
  if (!targetId) {
    return false;
  }
  const root = el.getRootNode();
  const panel =
    root instanceof Document || root instanceof ShadowRoot ? root.getElementById(targetId) : null;
  return panel !== null && isPopoverOpen(panel);
}

function isPopoverOpen(el: Element): boolean {
  if (!('hidePopover' in el)) {
    // No Popover API (jsdom): treat a popover in the path as open — the side
    // that never steals Escape from it.
    return true;
  }
  return el.matches(':popover-open');
}
