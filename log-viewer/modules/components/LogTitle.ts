/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../global.styles';
import { hostService } from '../services/VSCodeService';

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
    unsafeCSS(globalStyles),
    css`
      :host {
        --text-weight-semibold: 600;
        display: flex;
        align-items: center;
        min-width: 4ch;
      }
      .title-item {
        padding-block: 6px;
        padding-inline: 8px;
        background: var(--button-icon-background, rgba(90, 93, 94, 0.31));
        border-radius: var(--button-icon-corner-radius, 5px);
        font-weight: var(--text-weight-semibold, 600);
        font-size: 1.1rem;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
        cursor: pointer;

        &:hover {
          background-color: var(--button-icon-hover-background, rgba(90, 93, 94, 0.31));
          text-decoration: underline;
        }

        &:active {
          background: transparent;
          text-decoration: underline;
        }
      }
    `,
  ];

  render() {
    return html`<a class="title-item" href="#" @click="${this._goToLog}" title="${this.logPath}"
      >${this.logName}</a
    >`;
  }

  _goToLog() {
    hostService().openPath(this.logPath);
  }
}
