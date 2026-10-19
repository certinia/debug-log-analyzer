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

interface Stripped {
  el: Element;
  title: string;
  /** The attribute added so the element keeps its accessible name or description. */
  added: 'aria-label' | 'aria-description' | null;
}

/** The elements on `event`'s path that carry a `title`, innermost first. */
function titledPath(event: Event): Element[] {
  return event
    .composedPath()
    .filter((node): node is Element => node instanceof Element && !!node.getAttribute('title'));
}

/**
 * Shows every `title` in the app as one styled tooltip. A webview shows native `title`
 * tooltips only some of the time, so while the pointer or keyboard focus rests on an
 * element its `title` moves to `aria-label` (or `aria-description` when the element has
 * text) and comes back when it leaves.
 */
export class TooltipController implements ReactiveController {
  private readonly _tip: HoverTooltip = document.createElement('hover-tooltip');
  private _listeners: AbortController | null = null;
  private _anchor: Element | null = null;
  private _lastTarget: EventTarget | null = null;
  private _source: 'pointer' | 'focus' = 'pointer';
  private _stripped: Stripped[] = [];
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _shown = false;
  private _hiddenAt = Number.NEGATIVE_INFINITY;

  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    document.body.append(this._tip);
    this._listeners = new AbortController();
    const options = { capture: true, passive: true, signal: this._listeners.signal };
    // A webview frame does not always send `pointerover`, so the target is read from every move.
    document.addEventListener('pointermove', this._onPointerMove, options);
    document.addEventListener('focusin', this._onFocusIn, options);
    document.addEventListener('focusout', this._onFocusOut, options);
    document.addEventListener('keydown', this._onKeyDown, options);
    // The pointer is still on the element after these, so its title stays away until it leaves.
    for (const type of ['pointerdown', 'wheel', 'scroll']) {
      document.addEventListener(type, this._dismiss, options);
    }
    document.documentElement.addEventListener('pointerleave', this._end, options);
    window.addEventListener('blur', this._end, options);
  }

  hostDisconnected(): void {
    this._listeners?.abort();
    this._listeners = null;
    this._end();
    this._tip.remove();
  }

  private readonly _onPointerMove = (event: Event): void => {
    const target = event.composedPath()[0] ?? null;
    if (target === this._lastTarget) {
      return;
    }
    const titled = titledPath(event);
    if (!titled.length && this._anchor && event.composedPath().includes(this._anchor)) {
      this._lastTarget = target;
      return;
    }
    this._end();
    this._lastTarget = target;
    if (titled.length) {
      this._begin(titled, 'pointer');
    }
  };

  private readonly _onFocusIn = (event: Event): void => {
    const target = event.composedPath()[0];
    if (!(target instanceof Element) || !target.matches(':focus-visible')) {
      return;
    }
    const titled = titledPath(event);
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

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this._dismiss();
    }
  };

  private _begin(titled: Element[], source: 'pointer' | 'focus'): void {
    this._stripped = titled.map(strip);
    const [anchor] = titled;
    const text = this._stripped[0]?.title ?? '';
    this._anchor = anchor ?? null;
    this._source = source;
    const warm = performance.now() - this._hiddenAt < SKIP_DELAY_MS;
    this._timer = setTimeout(
      () => {
        if (anchor?.isConnected) {
          this._tip.show(anchor.getBoundingClientRect(), text);
          this._shown = true;
        }
      },
      warm ? 0 : SHOW_DELAY_MS,
    );
  }

  /** Hides the tooltip but keeps the titles away, so no native tooltip takes its place. */
  private readonly _dismiss = (): void => {
    clearTimeout(this._timer);
    if (this._shown) {
      this._tip.hide();
      this._shown = false;
      this._hiddenAt = performance.now();
    }
  };

  /** Hides the tooltip and gives the titles back. */
  private readonly _end = (): void => {
    this._dismiss();
    this._stripped.forEach(restore);
    this._stripped = [];
    this._anchor = null;
    this._lastTarget = null;
  };
}

function strip(el: Element): Stripped {
  const title = el.getAttribute('title') ?? '';
  el.removeAttribute('title');
  let added: Stripped['added'] = null;
  if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
    added = el.textContent?.trim() ? 'aria-description' : 'aria-label';
    el.setAttribute(added, title);
  }
  return { el, title, added };
}

function restore({ el, title, added }: Stripped): void {
  // A render while the title was away may have set a newer one.
  if (!el.hasAttribute('title')) {
    el.setAttribute('title', title);
  }
  if (added && el.getAttribute(added) === title) {
    el.removeAttribute(added);
  }
}
