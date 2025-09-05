/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { notificationStyles } from '../../../styles/notification.styles.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDivider());

@customElement('notification-panel')
export class NotificationPanel extends LitElement {
  @property({ type: Boolean })
  open = false;

  static styles = [
    globalStyles,
    css`
      :host {
        z-index: 999;
        ${notificationStyles}
      }
      .container {
        background-color: var(--vscode-editor-background);
        max-height: 540px;
        width: 320px;
        padding: 8px 4px 8px 4px;
        border: calc(var(--border-width) * 1px) solid var(--divider-background);
        box-shadow: rgba(0, 0, 0, 0.5) 0px 4px 20px;
        border-radius: 4px;
        overflow: scroll;
      }

      .closed {
        display: none;
      }
      .notification {
        padding: 8px 16px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
        display: flex;
        gap: 8px;
        border-radius: 4px;
      }
      .error-list {
        display: flex;
        flex-direction: column;
      }

      .notification-icon {
        justify-content: center;
        display: flex;
        flex-direction: column;
      }

      .no-messages {
        display: flex;
        justify-content: center;
      }

      .error {
        background-color: var(--notification-error-background);
      }

      .warning {
        background-color: var(--notification-warning-background);
      }

      .info {
        background-color: var(--notification-information-background);
      }

      .text-container {
        padding: 8px 0px 0px 0px;
      }
    `,
  ];

  render() {
    return html`<div class="container ${this.open ? '' : 'closed'}">
      <div class="error-list">
        <slot name="items"><h3 class="no-messages">No Items!</h3></slot>
      </div>
    </div>`;
  }
}

export type NotificationSeverity = 'Error' | 'Warning' | 'Info' | 'None';
export class Notification {
  summary = '';
  message: string | TemplateResult<1> = '';
  severity: NotificationSeverity = 'None';
  timestamp: number | null = null;
}
