/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';

import { tokenStyles } from '../styles/tokens.styles.js';

// px, as numbers: the placement maths runs in JS and cannot read a `--lana-space-*` var.
const GAP_PX = 4;
const EDGE_PX = 8;

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
        max-width: min(360px, calc(100vw - ${unsafeCSS(2 * EDGE_PX)}px));
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

  /** Whether the tooltip is on screen. */
  get open(): boolean {
    return this._open;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.popover = 'manual';
    this.role = 'tooltip';
  }

  render() {
    return html`<slot></slot>`;
  }

  /** Shows `text` below `anchorRect`, or above it when there is no room below. */
  show(anchorRect: DOMRect, text: string): void {
    this.textContent = text;
    // Measured at the origin: at the last tooltip's place near an edge it would wrap narrow.
    this.style.top = '0px';
    this.style.left = '0px';
    if (!this._open) {
      this.showPopover();
      this._open = true;
    }
    const { width, height } = this.getBoundingClientRect();
    const below = anchorRect.bottom + GAP_PX;
    const top =
      below + height > window.innerHeight - EDGE_PX ? anchorRect.top - GAP_PX - height : below;
    const centred = anchorRect.left + anchorRect.width / 2 - width / 2;
    const left = Math.min(Math.max(centred, EDGE_PX), window.innerWidth - width - EDGE_PX);
    this.style.top = `${Math.max(top, EDGE_PX)}px`;
    this.style.left = `${Math.max(left, EDGE_PX)}px`;
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
