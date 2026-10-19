/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';

import { tokenStyles } from '../styles/tokens.styles.js';

/** Space between the tooltip and the element it names (px). */
const GAP = 4;
/** Closest the tooltip comes to the window edge (px). */
const EDGE = 8;

/**
 * The one tooltip the app shows, in the top layer so no clip or stacking context hides it.
 * `TooltipController` owns when it shows and what it says.
 */
@customElement('hover-tooltip')
export class HoverTooltip extends LitElement {
  static styles = [
    tokenStyles,
    css`
      :host {
        position: fixed;
        inset: auto;
        box-sizing: border-box;
        max-width: min(360px, calc(100vw - ${unsafeCSS(2 * EDGE)}px));
        margin: 0;
        padding: var(--lana-space-2xs) var(--lana-space-sm);
        border: var(--lana-stroke) solid var(--lana-hover-border);
        border-radius: var(--lana-radius-sm);
        background: var(--lana-hover-bg);
        color: var(--lana-hover-fg);
        box-shadow: var(--lana-shadow-popover);
        font-family: var(--lana-font-ui);
        font-size: var(--lana-text-base);
        line-height: 1.4;
        white-space: pre-line;
        overflow-wrap: anywhere;
        pointer-events: none;
      }

      :host(:popover-open) {
        animation: fade-in 100ms ease-out;
      }

      @keyframes fade-in {
        from {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host(:popover-open) {
          animation: none;
        }
      }
    `,
  ];

  private _open = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.popover = 'manual';
    this.role = 'tooltip';
  }

  render() {
    return html`<slot></slot>`;
  }

  /** Shows `text` below `anchor`, or above it when there is no room below. */
  show(anchor: DOMRect, text: string): void {
    this.textContent = text;
    if (!this._open) {
      this.showPopover();
      this._open = true;
    }
    const { width, height } = this.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - EDGE ? anchor.top - GAP - height : below;
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(centred, EDGE), window.innerWidth - width - EDGE);
    this.style.top = `${Math.max(top, EDGE)}px`;
    this.style.left = `${Math.max(left, EDGE)}px`;
  }

  hide(): void {
    if (this._open) {
      this.hidePopover();
      this._open = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hover-tooltip': HoverTooltip;
  }
}
