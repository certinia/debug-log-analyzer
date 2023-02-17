/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { DatabaseAccess } from '../Database';
import { LogLine } from '../parsers/TreeParser';
import { showTreeNode } from '../TreeView';

@customElement('call-stack')
export class CallStack extends LitElement {
  @property({ type: Number })
  timestamp = -1;

  static get styles() {
    return css`
      a {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
      }

      .stackEntry {
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline;
      }

      .dbLinkContainer {
        display: flex;
      }
    `;
  }

  render() {
    const stack = DatabaseAccess.instance()?.getStack(this.timestamp).reverse() || [];
    if (stack.length) {
      const details = stack.map((entry) => this.lineLink(entry));
      return html`${details}`;
    } else {
      return html`<div class="stackEntry">No call stack available</div>`;
    }
  }

  private lineLink(line: LogLine) {
    return html`<div class="dbLinkContainer">
      <a @click=${this.onCallerClick} class="stackEntry" data-timestamp="${line.timestamp}"
        >${line.text}</a
      >
    </div> `;
  }

  private onCallerClick(evt: Event) {
    const target = evt.target as HTMLElement;
    const dataTimestamp = target.getAttribute('data-timestamp');
    if (dataTimestamp) {
      showTreeNode(parseInt(dataTimestamp));
    }
  }
}
