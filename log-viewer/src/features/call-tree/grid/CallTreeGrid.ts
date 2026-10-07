/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';

import { gridStyles, LvGrid } from '../../../grid/index.js';
import { globalStyles } from '../../../styles/global.styles.js';
import progressCss from '../../../tabulator/format/Progress.css';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

declare global {
  interface HTMLElementTagNameMap {
    'lv-call-tree-grid': CallTreeGrid;
  }
}

/** The grid's `--grid-*` properties from the app's `--lana-*` tokens. */
const theme = css`
  :host {
    --grid-bg: var(--lana-editor-bg);
    --grid-fg: var(--lana-editor-fg);
    --grid-muted-fg: var(--lana-fg-muted);
    --grid-border: var(--lana-surface-border);
    --grid-header-bg: var(--lana-editor-bg);
    --grid-hover-bg: var(--lana-row-hover-bg);
    --grid-marked-bg: var(--lana-row-hover-bg);
    --grid-selected-bg: var(--vscode-list-activeSelectionBackground, Highlight);
    --grid-selected-fg: var(--vscode-list-activeSelectionForeground, HighlightText);
    --grid-focus: var(--lana-focus-border);
    --grid-font: var(--lana-font-ui);
    --grid-font-size: var(--lana-text-base);
    --grid-tree-font: var(--lana-font-mono);
    --grid-pad: var(--lana-space-2xs);
    --grid-indent: var(--lana-indent-unit, 9px);
    --grid-stroke: var(--lana-stroke);
  }
`;

/** What the call-tree cells draw: bars, queries and their group headers. */
const cells = css`
  ${unsafeCSS(progressCss)}
  ${unsafeCSS(soqlSyntaxStyles)}

  .soql-group-header {
    display: flex;
    min-width: 0;
    align-items: center;
  }

  /* The query shrinks with an ellipsis, so the count stays in view after it. */
  .soql-group-header__q {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .soql-group-header__count {
    flex: none;
    margin-inline-start: var(--lana-space-xs);
  }
`;

/** `<lv-grid>` with the call-tree cell styles and the app theme in its shadow root. */
@customElement('lv-call-tree-grid')
export class CallTreeGrid<R extends object = object> extends LvGrid<R> {
  static styles = [globalStyles, gridStyles, theme, cells];
}
