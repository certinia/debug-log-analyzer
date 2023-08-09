/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DatabaseAccess } from '../Database';
import { goToRow } from '../calltree-view/CalltreeView';
import { LogLine } from '../parsers/TreeParser';

@customElement('call-stack')
export class CallStack extends LitElement {
  @property({ type: Number })
  timestamp = -1;

  static get styles() {
    return css`
      :host {
        flex: 1;
        overflow-y: scroll;
        min-width: 0%;
        max-height: 30vh;
        padding: 0px 5px 0px 5px;
      }
      a {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
      }

      .stackEntry {
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dbLinkContainer {
        display: flex;
      }

      .title {
        font-weight: bold;
      }
    `;
  }

  render() {
    const htmlTitle = html`<span class="title">Callstack</span>`;
    const stack = DatabaseAccess.instance()?.getStack(this.timestamp).reverse() || [];
    if (stack.length) {
      const details = stack.map((entry) => this.lineLink(entry));
      return html`${htmlTitle}${details}`;
    } else {
      return html`${htmlTitle}
        <div class="stackEntry">No call stack available</div>`;
    }
  }

  private lineLink(line: LogLine) {
    return html`<div class="dbLinkContainer" title="${line.text}">
      <a @click=${this.onCallerClick} class="stackEntry" data-timestamp="${line.timestamp}"
        >${line.text}</a
      >
    </div> `;
  }

  private onCallerClick(evt: Event) {
    const target = evt.target as HTMLElement;
    const dataTimestamp = target.getAttribute('data-timestamp');
    if (dataTimestamp) {
      goToRow(parseInt(dataTimestamp));
    }
  }
}
