/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { vscodeMessenger } from '../core/messaging/VSCodeExtensionMessenger.js';
// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

provideVSCodeDesignSystem().register(vsCodeButton());

@customElement('log-title')
export class LogTitle extends LitElement {
  @property()
  logName = '';

  @property()
  logPath = '';
  /**
   * --button-icon styles come from @vscode/webview-ui-toolkit as they are hardcoded in vscode at the moment. @vscode/webview-ui-toolkit needs to be in use for these to work.
   */
  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        --text-weight-semibold: 600;
        display: inline-flex;
        align-items: center;
        min-width: 4ch;
        min-height: 1rem;
        max-width: 60ch;
        flex: 0 1 auto;
        overflow: hidden;
      }

      .title-item {
        padding-block: 2px;
        padding-inline: 6px;
        background: var(--button-icon-background, rgba(90, 93, 94, 0.31));
        border-radius: var(--button-icon-corner-radius, 5px);
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
        color: var(--vscode-editor-foreground);

        &:hover,
        &:active {
          background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
          color: var(--vscode-editor-foreground);
          text-decoration: none;
        }
      }
    `,
  ];

  render() {
    if (!this.logName) {
      return html`<div class="skeleton">&nbsp;</div>`;
    }

    return html`<a class="title-item" href="#" @click="${this._goToLog}" title="${this.logPath}"
      >${this.logName}</a
    >`;
  }

  _goToLog() {
    vscodeMessenger.send<string>('openPath', this.logPath);
  }
}
