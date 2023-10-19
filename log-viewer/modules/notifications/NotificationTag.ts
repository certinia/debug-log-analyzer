/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../components/BadgeBase.js';
import { globalStyles } from '../global.styles.js';
import './NotificationPanel.js';

provideVSCodeDesignSystem().register(vsCodeButton());

@customElement('notification-tag')
export class NotificationTag extends LitElement {
  @state()
  open = false;

  @property()
  notifications: Notification[] = [];

  constructor() {
    super();
    document.addEventListener('click', (event) => {
      if (!event.composedPath().includes(this)) {
        this.open = false;
      }
    });
  }

  static styles = [
    globalStyles,
    css`
      :host {
      }

      .icon {
        position: relative;
        width: 32px;
        height: 32px;
      }
      .icon-svg {
        width: 20px;
        height: 20px;
      }

      .badge-indicator {
        color: rgb(255, 255, 255);
        background-color: rgb(0, 120, 212);
        position: absolute;
        bottom: 18px;
        left: 18px;
        font-size: 9px;
        font-weight: 600;
        min-width: 8px;
        height: 16px;
        line-height: 16px;
        padding: 0px 4px;
        border-radius: 20px;
        text-align: center;
      }

      .tag-panel {
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
      }

      .menu-container {
        position: relative;
      }
    `,
  ];

  render() {
    const status = this.notifications.length > 0 ? 'failure' : 'success';

    return html`<div class="menu-container">
      <vscode-button appearance="icon">
        <badge-base status="${status}" @click="${this._toggleNotifications}"
          >${this.notifications.length} issues
        </badge-base>
      </vscode-button>
      <notification-panel
        class="tag-panel"
        .notifications="${this.notifications}"
        .open="${this.open}"
      >
      </notification-panel>
    </div>`;
  }

  _toggleNotifications() {
    this.open = !this.open;
  }
}

export class Notification {
  summary = '';
  message = '';
  severity: 'Error' | 'Warning' | 'Info' | 'none' = 'none';
}
