/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('icon-button-skeleton')
export class IconButton extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

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
    if (this.logStatus !== 'parsing') {
      return nothing;
    }
    return html` <span class="skeleton"></span>`;
  }
}
