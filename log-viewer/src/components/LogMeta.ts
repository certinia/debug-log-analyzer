/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { headerItemStyles } from '../styles/headerItem.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';
import { tokenStyles } from '../styles/tokens.styles.js';

import './DotSeparator.js';

@customElement('log-meta')
export class LogMeta extends LitElement {
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
