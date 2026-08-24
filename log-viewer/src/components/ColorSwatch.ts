/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { tokenStyles } from '../styles/tokens.styles.js';

/**
 * The colour key beside a label — a legend chip, a reveal row, a tooltip row. One
 * shape for every one of them, so a hue means the same thing wherever it appears.
 *
 * A custom element rather than a shared stylesheet, because the canvas tooltips
 * build their panels imperatively and cannot adopt a Lit one.
 *
 * The hue is decorative: whatever it stands for is named in text beside it, so the
 * swatch is hidden from a screen reader and only ever carries a hover title.
 */
@customElement('color-swatch')
export class ColorSwatch extends LitElement {
  /** Any CSS colour. Unset, the swatch takes `--row-hue` from the row around it. */
  @property()
  color = '';

  /** What the colour stands for, shown on hover. */
  @property()
  label = '';

  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        /* Centred against a taller line, and never squeezed by a flex or grid parent. */
        align-self: center;
        flex: 0 0 auto;
        width: var(--lana-swatch-size);
        height: var(--lana-swatch-size);
        border-radius: var(--lana-swatch-radius);
        background: var(--row-hue);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
  }

  protected updated(): void {
    // A colour is data, not a token, so it is written as a style rather than declared
    // above. Cleared rather than set empty, so `--row-hue` can answer again.
    this.style.setProperty('background', this.color || null);
    if (this.label) {
      this.title = this.label;
    } else {
      this.removeAttribute('title');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'color-swatch': ColorSwatch;
  }
}
