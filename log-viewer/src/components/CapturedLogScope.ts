/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume, provide } from '@lit/context';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';

/** Gives its children the log as captured, whatever debug levels the header has chosen. */
@customElement('captured-log-scope')
export class CapturedLogScope extends LitElement {
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  @provide({ context: logContext })
  capturedStore: LogStore | null = null;

  static styles = css`
    :host {
      display: contents;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('logStore')) {
      this.capturedStore = this.logStore?.captured ?? null;
    }
  }

  render() {
    return html`<slot></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'captured-log-scope': CapturedLogScope;
  }
}
