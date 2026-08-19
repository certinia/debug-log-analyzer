/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { vscodeMessenger } from '../core/messaging/VSCodeExtensionMessenger.js';
// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('log-title')
export class LogTitle extends LitElement {
  @property()
  logName = '';

  @property()
  logPath = '';

  /** Appended to the tooltip — carries the log meta once the header collapses it. */
  @property()
  details = '';

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        --text-weight-semibold: 600;
        display: inline-flex;
        align-items: center;
        /* Floor, not a nicety: without it the title shreds itself to nothing while the
           header's controls keep their space, so nav-bar's collapse ladder never
           engages. nav-bar reads this value back to budget the ladder. */
        min-width: 16ch;
        min-height: 1rem;
        max-width: 60ch;
        flex: 0 1 auto;
        overflow: hidden;
      }

      .title-item {
        padding-block: 2px;
        padding-inline: 6px;
        background: transparent;
        border-radius: var(--lana-radius-sm);
        font-weight: var(--text-weight-semibold, 600);
        font-size: 1.1rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        width: 100%;
        min-width: 4ch;
      }

      a.title-item {
        color: var(--lana-editor-fg);

        &:hover,
        &:active {
          background-color: var(--lana-toolbar-hover-bg);
          color: var(--lana-editor-fg);
          text-decoration: none;
        }
      }
    `,
  ];

  render() {
    if (!this.logName) {
      return html`<div class="skeleton">&nbsp;</div>`;
    }

    const tooltip = this.details ? `${this.logPath}\n${this.details}` : this.logPath;

    return html`<a class="title-item" href="#" @click="${this._goToLog}" title="${tooltip}"
      >${this.logName}</a
    >`;
  }

  _goToLog() {
    vscodeMessenger.send<string>('openPath', this.logPath);
  }
}
