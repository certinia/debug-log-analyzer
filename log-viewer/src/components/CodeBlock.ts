/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { formatSOQLToTemplate } from '../features/soql/format/formatter.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { panelTokens } from './panelTokens.js';

export type CodeLanguage = 'soql' | 'sosl' | 'plain';

/**
 * A read-only code snippet with a hover/focus copy button (top-right), like the
 * copy affordance on documentation sites. Text stays natively selectable so a
 * user can also highlight a portion and copy it. SOQL/SOSL is syntax
 * highlighted; `plain` renders verbatim.
 */
@customElement('code-block')
export class CodeBlock extends LitElement {
  @property({ type: String })
  code = '';

  @property({ type: String })
  language: CodeLanguage = 'plain';

  @state()
  private _copied = false;

  static styles = [
    globalStyles,
    panelTokens,
    unsafeCSS(soqlSyntaxStyles),
    css`
      :host {
        display: block;
      }

      .code-block {
        position: relative;
        overflow: auto;
        padding: var(--space-2);
        border: 1px solid var(--vscode-widget-border, transparent);
        border-radius: var(--panel-radius);
        background-color: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      }

      pre {
        margin: 0;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--vscode-editor-font-size, 0.9em);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .copy {
        position: absolute;
        top: var(--space-1);
        right: var(--space-1);
        opacity: 0;
        transition: opacity 0.1s ease;
        color: var(--vscode-icon-foreground);
        background-color: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      }
      .code-block:hover .copy,
      .code-block:focus-within .copy,
      .copy:focus-visible {
        opacity: 1;
      }

      @media (prefers-reduced-motion: reduce) {
        .copy {
          transition: none;
        }
      }
    `,
  ];

  render() {
    return html`<div class="code-block">
      <vscode-icon
        class="copy"
        action-icon
        name=${this._copied ? 'check' : 'copy'}
        label="Copy"
        title=${this._copied ? 'Copied' : 'Copy'}
        @click=${this._copy}
      ></vscode-icon>
      <pre>${this._content()}</pre>
    </div>`;
  }

  private _content() {
    if (this.language === 'plain') {
      return this.code;
    }
    return html`<span class="soql-block"
      >${formatSOQLToTemplate(this.code, { mode: 'pretty', dialect: this.language })}</span
    >`;
  }

  private _copy = () => {
    navigator.clipboard?.writeText(this.code).then(
      () => {
        this._copied = true;
        this.requestUpdate();
        setTimeout(() => {
          this._copied = false;
          this.requestUpdate();
        }, 1000);
      },
      () => {
        /* clipboard unavailable — no-op */
      },
    );
  };
}
