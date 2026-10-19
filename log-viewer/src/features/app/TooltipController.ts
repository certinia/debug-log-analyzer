/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import '../../components/HoverTooltip.js';
import type { HoverTooltip } from '../../components/HoverTooltip.js';

/** How long the pointer rests on an element before its tooltip shows. */
const SHOW_DELAY_MS = 500;
/** A tooltip that follows another this soon shows at once, as the pointer scans a toolbar. */
const SKIP_DELAY_MS = 300;
/** How long a tooltip outlives the pointer, so the pointer can cross onto it. */
const LEAVE_DELAY_MS = 100;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

interface Stripped {
  /** The element's own title, or null once the app removed it. */
  title: string | null;
  /** The attribute added so the element keeps its accessible name or description. */
  added: 'aria-label' | 'aria-description' | null;
}

/**
 * Shows every `title` in the app as one styled tooltip. A webview shows native `title`
 * tooltips only some of the time, so while the pointer or keyboard focus rests on an
 * element its `title` is emptied, which also stops an ancestor's, and its text moves to
 * `aria-label` (or `aria-description` when the element has text). Both come back when it
 * leaves. A title the app changes meanwhile is the one that comes back.
 */
export class TooltipController implements ReactiveController {
  private readonly _tip: HoverTooltip = document.createElement('hover-tooltip');
  private readonly _observer = new MutationObserver((records) => this._onTitleChange(records));
  private _listeners: AbortController | null = null;
  private _anchor: Element | null = null;
  private _source: 'pointer' | 'focus' = 'pointer';
  private _stripped = new Map<Element, Stripped>();
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
    document.addEventListener('focusin', this._onFocusIn, options);
    document.addEventListener('focusout', this._onFocusOut, options);
    // Not passive: an Escape that closes a tooltip is consumed, so it does not also deselect.
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

  /** The elements on `path` with a title, the ones emptied for a tooltip included, innermost first. */
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
      clearTimeout(this._leaveTimer);
      return;
    }
    const titled = this._titled(path);
    const [inner] = titled;
    if (inner && inner === this._anchor) {
      clearTimeout(this._leaveTimer);
      return;
    }
    if (!inner) {
      if (this._anchor && this._source === 'pointer') {
        clearTimeout(this._leaveTimer);
        this._leaveTimer = setTimeout(this._end, LEAVE_DELAY_MS);
      }
      return;
    }
    this._end();
    this._begin(titled, 'pointer');
  };

  private readonly _onFocusIn = (event: Event): void => {
    const path = event.composedPath();
    const target = path[0];
    if (!(target instanceof Element) || !target.matches(':focus-visible')) {
      return;
    }
    const titled = this._titled(path);
    if (titled.length) {
      this._end();
      this._begin(titled, 'focus');
    }
  };

  private readonly _onFocusOut = (): void => {
    if (this._source === 'focus') {
      this._end();
    }
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

  private _begin(titled: Element[], source: 'pointer' | 'focus'): void {
    for (const el of titled) {
      this._stripped.set(el, strip(el));
      this._observer.observe(el, { attributes: true, attributeFilter: ['title'] });
    }
    this._anchor = titled[0] ?? null;
    this._source = source;
    const warm = performance.now() - this._hiddenAt < SKIP_DELAY_MS;
    this._showTimer = setTimeout(() => this._show(), warm ? 0 : SHOW_DELAY_MS);
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
      const title = el.getAttribute('title');
      // Our own emptying.
      if (!stripped || title === '') {
        continue;
      }
      stripped.title = title;
      if (stripped.added) {
        if (title === null) {
          el.removeAttribute(stripped.added);
        } else {
          el.setAttribute(stripped.added, title);
        }
      }
      if (title !== null) {
        el.setAttribute('title', '');
      }
      if (el === this._anchor && this._tip.open) {
        if (title === null) {
          this._dismiss();
        } else {
          this._show();
        }
      }
    }
  }

  /** Hides the tooltip but keeps the titles away, so no native tooltip takes its place. */
  private readonly _dismiss = (): void => {
    clearTimeout(this._showTimer);
    clearTimeout(this._leaveTimer);
    if (this._tip.open) {
      this._tip.hide();
      this._hiddenAt = performance.now();
    }
  };

  /** Hides the tooltip and gives the titles back. */
  private readonly _end = (): void => {
    this._dismiss();
    this._onTitleChange(this._observer.takeRecords());
    this._observer.disconnect();
    this._stripped.forEach((stripped, el) => restore(el, stripped));
    this._stripped.clear();
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
