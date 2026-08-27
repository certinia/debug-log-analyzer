/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { tokenStyles } from '../styles/tokens.styles.js';

/**
 * The colour key beside a label — a legend chip, a stacked bar's key, a tooltip row.
 * One shape for every one of them, so a hue means the same thing wherever it appears.
 *
 * A custom element rather than a shared stylesheet, because the metric strip's tooltip
 * builds its panel as an HTML string and carries no stylesheet of its own; the element
 * brings its own, tokens included.
 *
 * The hue is decorative: whatever it stands for is always named in text beside it, so
 * the swatch stays hidden from a screen reader.
 */
@customElement('color-swatch')
export class ColorSwatch extends LitElement {
  /** Any CSS colour. */
  @property()
  color = '';

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
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // Lit offers no declarative host attribute, and the spec forbids setting one in a
    // constructor, so this is the only place it can go.
    this.setAttribute('aria-hidden', 'true');
  }

  protected updated(): void {
    // A colour is data, not a token, so it is written as a style rather than declared above.
    this.style.background = this.color;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'color-swatch': ColorSwatch;
  }
}
