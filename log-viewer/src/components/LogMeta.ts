/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { consume } from '@lit/context';
import { customElement, property } from 'lit/decorators.js';

import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';

import { headerItemStyles } from '../styles/headerItem.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';
import { tokenStyles } from '../styles/tokens.styles.js';

import './DotSeparator.js';

@customElement('log-meta')
export class LogMeta extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

  static styles = [
    tokenStyles,
    skeletonStyles,
    headerItemStyles,
    css`
      .log__metadata {
        display: inline-flex;
        gap: 8px;
        align-items: center;
      }

      .metadata__item {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }

      .metadata__item.skeleton {
        height: 80%;
      }
    `,
  ];

  @property()
  logDuration: number | null = null;

  @property()
  logFileSize: number | null = null;

  render() {
    if (!this.logDuration && !this.logFileSize) {
      if (this.logStatus !== 'parsing') {
        return nothing;
      }
      return html`<div class="log__metadata">
        <span class="metadata__item skeleton" style="width: 8ch;"></span>
        <dot-separator></dot-separator>
        <span class="metadata__item skeleton" style="width: 5ch;"></span>
      </div>`;
    }

    return html`<div class="log__metadata">
      <span class="metadata__item">${this.logFileSize}</span>
      <dot-separator></dot-separator>
      <span class="metadata__item">${this.logDuration}</span>
    </div>`;
  }
}
