/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import '../../components/HoverTooltip.js';
import type { HoverTooltip } from '../../components/HoverTooltip.js';

const SHOW_DELAY_MS = 500;
// A tooltip that follows another this soon shows at once, as the pointer scans a toolbar.
const SKIP_DELAY_MS = 300;
// Long enough for the pointer to cross the gap onto the tooltip.
const LEAVE_DELAY_MS = 100;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

interface Stripped {
  // Null once the app removed the title, so it is not put back.
  title: string | null;
  added: 'aria-label' | 'aria-description' | null;
}

/**
 * Shows every `title` in the app as one styled tooltip. VS Code shows this panel's native
 * `title` tooltips only some of the time, depending on where focus is, so while the
 * pointer rests on an element its `title` is emptied, which also stops an ancestor's,
 * and its text moves to `aria-label` (or `aria-description` when the element has text).
 * Both come back when the pointer leaves. A title the app changes meanwhile is the one
 * that comes back.
 */
export class TooltipController implements ReactiveController {
  private readonly _tip: HoverTooltip = document.createElement('hover-tooltip');
  private readonly _observer = new MutationObserver((records) => this._onTitleChange(records));
  private _listeners: AbortController | null = null;
  private _anchor: Element | null = null;
  private _stripped = new Map<Element, Stripped>();
  // Elements whose title we just emptied again, so their record is ours, not the app's.
  private _ownWrites = new Set<Element>();
  private _showTimer: ReturnType<typeof setTimeout> | undefined;
  private _leaveTimer: ReturnType<typeof setTimeout> | undefined;
  private _hiddenAt = Number.NEGATIVE_INFINITY;

  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    document.body.append(this._tip);
    this._listeners = new AbortController();
    const { signal } = this._listeners;
    const options = { capture: true, passive: true, signal };
    // A webview frame does not always send `pointerover`, so the target is read from every move.
    document.addEventListener('pointermove', this._onPointerMove, options);
    // Not passive: an Escape that closes a tooltip is consumed, so the tables do not also deselect.
    document.addEventListener('keydown', this._onKeyDown, { capture: true, signal });
    // The pointer is still on the element after these, so its title stays away until it leaves.
    for (const type of ['pointerdown', 'wheel', 'scroll']) {
      document.addEventListener(type, this._dismiss, options);
    }
    document.documentElement.addEventListener('pointerleave', this._onPointerLeave, options);
    window.addEventListener('blur', this._end, { passive: true, signal });
  }

  hostDisconnected(): void {
    this._listeners?.abort();
    this._listeners = null;
    this._end();
    this._tip.remove();
  }

  // Emptied titles count, so a move within a titled ancestor keeps its tooltip.
  private _titled(path: EventTarget[]): Element[] {
    return path.filter((node): node is Element => {
      if (!(node instanceof Element)) {
        return false;
      }
      const stripped = this._stripped.get(node);
      return stripped ? stripped.title !== null : !!node.getAttribute('title');
    });
  }

  private readonly _onPointerMove = (event: Event): void => {
    const path = event.composedPath();
    if (path.includes(this._tip)) {
      this._stay();
      return;
    }
    const titled = this._titled(path);
    const [anchor] = titled;
    if (!anchor) {
      this._leave();
      return;
    }
    if (anchor === this._anchor) {
      this._stay();
      return;
    }
    this._end();
    this._begin(anchor, titled);
  };

  private readonly _onPointerLeave = (event: Event): void => {
    // Capture also hears every descendant the pointer leaves; only leaving the page counts.
    if (event.target === document.documentElement) {
      this._end();
    }
  };

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (MODIFIER_KEYS.has(event.key)) {
      return;
    }
    if (event.key === 'Escape' && this._tip.open) {
      event.preventDefault();
    }
    // Keys also scroll grids in shadow roots, whose `scroll` never reaches the document.
    this._dismiss();
  };

  private _begin(anchor: Element, titled: Element[]): void {
    for (const el of titled) {
      this._stripped.set(el, strip(el));
      this._observer.observe(el, { attributes: true, attributeFilter: ['title'] });
    }
    this._anchor = anchor;
    const warm = performance.now() - this._hiddenAt < SKIP_DELAY_MS;
    this._showTimer = setTimeout(() => this._show(), warm ? 0 : SHOW_DELAY_MS);
  }

  private _stay(): void {
    clearTimeout(this._leaveTimer);
    this._leaveTimer = undefined;
  }

  private _leave(): void {
    if (!this._anchor) {
      return;
    }
    // Nothing on screen to cross onto, so a pending tooltip ends now.
    if (!this._tip.open) {
      this._end();
    } else if (this._leaveTimer === undefined) {
      this._leaveTimer = setTimeout(this._end, LEAVE_DELAY_MS);
    }
  }

  private _show(): void {
    const anchor = this._anchor;
    const title = anchor ? this._stripped.get(anchor)?.title : null;
    if (anchor?.isConnected && title) {
      this._tip.show(anchor.getBoundingClientRect(), title);
    }
  }

  private _onTitleChange(records: MutationRecord[]): void {
    for (const { target } of records) {
      const el = target as Element;
      const stripped = this._stripped.get(el);
      if (!stripped || this._ownWrites.delete(el)) {
        continue;
      }
      const title = el.getAttribute('title');
      retitle(el, stripped, title);
      if (title !== null) {
        this._ownWrites.add(el);
        el.setAttribute('title', '');
      }
      if (el === this._anchor && this._tip.open) {
        if (title) {
          this._show();
        } else {
          this._dismiss();
        }
      }
    }
  }

  // Hides the tooltip but keeps the titles away, so no native tooltip takes its place.
  private readonly _dismiss = (): void => {
    clearTimeout(this._showTimer);
    this._stay();
    if (this._tip.open) {
      this._tip.hide();
      this._hiddenAt = performance.now();
    }
  };

  private readonly _end = (): void => {
    this._dismiss();
    this._onTitleChange(this._observer.takeRecords());
    this._observer.disconnect();
    this._stripped.forEach((stripped, el) => restore(el, stripped));
    this._stripped.clear();
    this._ownWrites.clear();
    this._anchor = null;
  };
}

function strip(el: Element): Stripped {
  const title = el.getAttribute('title') ?? '';
  // Empty, not removed: an empty title hides the ancestors' too, and the app's next write shows.
  el.setAttribute('title', '');
  let added: Stripped['added'] = null;
  if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
    added = el.textContent?.trim() ? 'aria-description' : 'aria-label';
    el.setAttribute(added, title);
  }
  return { title, added };
}

function retitle(el: Element, stripped: Stripped, title: string | null): void {
  stripped.title = title;
  if (!stripped.added) {
    return;
  }
  if (title) {
    el.setAttribute(stripped.added, title);
  } else {
    el.removeAttribute(stripped.added);
  }
}

function restore(el: Element, { title, added }: Stripped): void {
  if (title === null) {
    el.removeAttribute('title');
  } else {
    el.setAttribute('title', title);
  }
  if (added) {
    el.removeAttribute(added);
  }
}
