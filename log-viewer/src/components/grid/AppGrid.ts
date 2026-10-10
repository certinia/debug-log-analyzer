/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css, unsafeCSS, type CSSResultGroup } from 'lit';
import { customElement } from 'lit/decorators.js';

import { gridStyles, LvGrid } from '../../grid/index.js';
import { globalStyles } from '../../styles/global.styles.js';
import progressCss from '../../tabulator/format/Progress.css';
import { soqlSyntaxStyles } from '../../features/soql/styles/soql-syntax.css.js';

declare global {
  interface HTMLElementTagNameMap {
    'lv-app-grid': AppGrid;
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
    --grid-find-fg: var(--vscode-editor-findMatchHighlightForeground, currentColor);
    --grid-find-bg: var(--vscode-editor-findMatchHighlightBackground, yellow);
    --grid-find-current-fg: var(--vscode-editor-findMatchForeground, currentColor);
    --grid-find-current-bg: var(--vscode-editor-findMatchBackground, #8b8000);
    /* The editor selects its current match, so the selection lies under it. */
    --grid-find-current-under-bg: var(--vscode-editor-selectionBackground, Highlight);
    --grid-font: var(--lana-font-ui);
    --grid-font-size: var(--lana-text-base);
    --grid-tree-font: var(--lana-font-mono);
    --grid-pad: var(--lana-space-2xs);
    --grid-indent: var(--lana-indent-unit, 9px);
    --grid-stroke: var(--lana-stroke);
  }
`;

/** What the app's cells draw: bars, queries and their group headers. */
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

  /* The codicon chevrons of the Tabulator trees. A glyph box, not text, so outside the type ramp. */
  .twisty.closed::before,
  .twisty.open::before {
    border: none;
    font-family: 'codicon';
    font-size: 14px;
    /* The text's line, so a row with a twisty is no taller than a leaf. */
    line-height: 1lh;
    vertical-align: top;
  }

  .twisty.closed::before {
    content: '\\eab6';
  }

  .twisty.open::before {
    content: '\\eab4';
    rotate: none;
  }
`;

/** `<lv-grid>` with the app theme and the styles of the shared cells in its shadow root. */
@customElement('lv-app-grid')
export class AppGrid<R extends object = object> extends LvGrid<R> {
  static styles: CSSResultGroup = [globalStyles, gridStyles, theme, cells];
}
