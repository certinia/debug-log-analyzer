/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('icon-button-skeleton')
export class IconButton extends LitElement {
  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: inline-flex;
      }
      .skeleton {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  render() {
    return html` <span class="skeleton"></span>`;
  }
}
