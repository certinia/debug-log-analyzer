/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, TemplateResult, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../components/LogTitle';
import { TruncationEntry } from '../parsers/TreeParser';

provideVSCodeDesignSystem().register(vsCodeButton());

@customElement('notification-panel')
export class NotificationPanel extends LitElement {
  @state()
  open = false;

  @property()
  truncated: TruncationEntry[] = [];

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
    .container {
      position: absolute;
      background-color: var(--vscode-editor-background);
      max-height: 540px;
      width: 320px;
      z-index: 999;
      right: 12px;
      padding: 8px 5px 8px 5px;
      border: calc(var(--border-width) * 1px) solid var(--vscode-panel-border);
      box-shadow: rgba(0, 0, 0, 0.5) 0px 4px 20px;
      border-radius: 4px;
      overflow: scroll;
    }

    .closed {
      display: none;
    }
    .status__reason {
      padding: 4px;
      overflow-wrap: anywhere;
    }
    .error-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
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

    .no-messages {
      display: flex;
      justify-content: center;
    }
  `;

  render() {
    const messages: TemplateResult[] = [];
    this.truncated.forEach((item) => {
      messages.push(html`<div class="status__reason" style="background-color:${item.color}">
        ${item.reason}
      </div>`);
    });

    if (this.truncated.length < 1) {
      messages.push(html`<div class="no-messages"><h3>No Messages!</h3></div>`);
    }

    const indicator =
      this.truncated.length > 0
        ? html`<div class="badge-indicator">${this.truncated.length}</div>`
        : html``;

    return html` <vscode-button
        appearance="icon"
        class="icon"
        aria-label="Notifications"
        title="Notifications"
        @click="${this._toggleNotifications}"
      >
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
          <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
          <g id="SVGRepo_iconCarrier">
            <path
              d="M11.713 7.14977C12.1271 7.13953 12.4545 6.79555 12.4443 6.38146C12.434 5.96738 12.0901 5.63999 11.676 5.65023L11.713 7.14977ZM6.30665 12.193H7.05665C7.05665 12.1874 7.05659 12.1818 7.05646 12.1761L6.30665 12.193ZM6.30665 14.51L6.34575 15.259C6.74423 15.2382 7.05665 14.909 7.05665 14.51H6.30665ZM6.30665 17.6L6.26755 18.349C6.28057 18.3497 6.29361 18.35 6.30665 18.35L6.30665 17.6ZM9.41983 18.35C9.83404 18.35 10.1698 18.0142 10.1698 17.6C10.1698 17.1858 9.83404 16.85 9.41983 16.85V18.35ZM10.9445 6.4C10.9445 6.81421 11.2803 7.15 11.6945 7.15C12.1087 7.15 12.4445 6.81421 12.4445 6.4H10.9445ZM12.4445 4C12.4445 3.58579 12.1087 3.25 11.6945 3.25C11.2803 3.25 10.9445 3.58579 10.9445 4H12.4445ZM11.713 5.65023C11.299 5.63999 10.955 5.96738 10.9447 6.38146C10.9345 6.79555 11.2619 7.13953 11.676 7.14977L11.713 5.65023ZM17.0824 12.193L16.3325 12.1761C16.3324 12.1818 16.3324 12.1874 16.3324 12.193H17.0824ZM17.0824 14.51H16.3324C16.3324 14.909 16.6448 15.2382 17.0433 15.259L17.0824 14.51ZM17.0824 17.6V18.35C17.0954 18.35 17.1084 18.3497 17.1215 18.349L17.0824 17.6ZM13.9692 16.85C13.555 16.85 13.2192 17.1858 13.2192 17.6C13.2192 18.0142 13.555 18.35 13.9692 18.35V16.85ZM10.1688 17.6027C10.1703 17.1885 9.83574 16.8515 9.42153 16.85C9.00732 16.8485 8.67034 17.1831 8.66886 17.5973L10.1688 17.6027ZM10.0848 19.3L10.6322 18.7873L10.6309 18.786L10.0848 19.3ZM13.3023 19.3L12.7561 18.786L12.7549 18.7873L13.3023 19.3ZM14.7182 17.5973C14.7167 17.1831 14.3797 16.8485 13.9655 16.85C13.5513 16.8515 13.2167 17.1885 13.2182 17.6027L14.7182 17.5973ZM9.41788 16.85C9.00366 16.85 8.66788 17.1858 8.66788 17.6C8.66788 18.0142 9.00366 18.35 9.41788 18.35V16.85ZM13.9692 18.35C14.3834 18.35 14.7192 18.0142 14.7192 17.6C14.7192 17.1858 14.3834 16.85 13.9692 16.85V18.35ZM11.676 5.65023C8.198 5.73622 5.47765 8.68931 5.55684 12.2099L7.05646 12.1761C6.99506 9.44664 9.09735 7.21444 11.713 7.14977L11.676 5.65023ZM5.55665 12.193V14.51H7.05665V12.193H5.55665ZM6.26755 13.761C5.0505 13.8246 4.125 14.8488 4.125 16.055H5.625C5.625 15.6136 5.95844 15.2792 6.34575 15.259L6.26755 13.761ZM4.125 16.055C4.125 17.2612 5.0505 18.2854 6.26755 18.349L6.34575 16.851C5.95843 16.8308 5.625 16.4964 5.625 16.055H4.125ZM6.30665 18.35H9.41983V16.85H6.30665V18.35ZM12.4445 6.4V4H10.9445V6.4H12.4445ZM11.676 7.14977C14.2917 7.21444 16.3939 9.44664 16.3325 12.1761L17.8322 12.2099C17.9114 8.68931 15.191 5.73622 11.713 5.65023L11.676 7.14977ZM16.3324 12.193V14.51H17.8324V12.193H16.3324ZM17.0433 15.259C17.4306 15.2792 17.764 15.6136 17.764 16.055H19.264C19.264 14.8488 18.3385 13.8246 17.1215 13.761L17.0433 15.259ZM17.764 16.055C17.764 16.4964 17.4306 16.8308 17.0433 16.851L17.1215 18.349C18.3385 18.2854 19.264 17.2612 19.264 16.055H17.764ZM17.0824 16.85H13.9692V18.35H17.0824V16.85ZM8.66886 17.5973C8.66592 18.4207 8.976 19.2162 9.53861 19.814L10.6309 18.786C10.335 18.4715 10.1673 18.0473 10.1688 17.6027L8.66886 17.5973ZM9.53739 19.8127C10.0977 20.4109 10.8758 20.7529 11.6935 20.7529V19.2529C11.2969 19.2529 10.9132 19.0873 10.6322 18.7873L9.53739 19.8127ZM11.6935 20.7529C12.5113 20.7529 13.2894 20.4109 13.8497 19.8127L12.7549 18.7873C12.4739 19.0873 12.0901 19.2529 11.6935 19.2529V20.7529ZM13.8484 19.814C14.4111 19.2162 14.7211 18.4207 14.7182 17.5973L13.2182 17.6027C13.2198 18.0473 13.0521 18.4715 12.7561 18.786L13.8484 19.814ZM9.41788 18.35H13.9692V16.85H9.41788V18.35Z"
              fill="currentColor"
            ></path>
          </g>
        </svg>
        ${indicator}
      </vscode-button>
      <div class="container ${this.open ? '' : 'closed'}">
        <div class="error-list">${html`${messages}`}</div>
      </div>`;
  }

  _toDuration(duration: number | null) {
    if (!duration && duration !== 0) {
      return '';
    }

    return (duration / 1_000_000_000).toFixed(3) + 's';
  }

  _toggleNotifications() {
    this.open = !this.open;
  }
}
