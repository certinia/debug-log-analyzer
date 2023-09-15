/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeTag } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './NotificationPanel';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTag());

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

  static styles = css`
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

    .status-tag {
      position: relative;
      font-family: monospace;
      font-size: inherit;
    }

    .status-tag::part(control) {
      color: var(--vscode-editor-foreground);
      background-color: var(--button-icon-hover-background, rgba(90, 93, 94, 0.31));
      text-transform: inherit;
      border: none;
    }

    .success-tag::part(control) {
      background-color: rgba(128, 255, 128, 0.2);
    }

    .failure-tag::part(control) {
      background-color: rgba(255, 128, 128, 0.2);
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
  `;

  render() {
    const issueColor = this.notifications.length > 0 ? 'failure-tag' : 'success-tag';

    return html`<div class="menu-container">
      <vscode-button appearance="icon">
        <vscode-tag class="status-tag ${issueColor}" @click="${this._toggleNotifications}"
          >${this.notifications.length} issues
        </vscode-tag>
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
