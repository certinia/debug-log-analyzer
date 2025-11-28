/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { skeletonStyles } from '../styles/skeleton.styles.js';

import './DotSeparator.js';

@customElement('log-meta')
export class LogMeta extends LitElement {
  static styles = [
    skeletonStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }

      .log__metadata {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        font-size: 0.9rem;
        color: var(--vscode-descriptionForeground, #999);
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
