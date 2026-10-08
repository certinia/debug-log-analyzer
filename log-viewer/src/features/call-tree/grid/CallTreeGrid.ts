/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { gridStyles, LvGrid } from '../../../grid/index.js';
import { globalStyles } from '../../../styles/global.styles.js';
import progressCss from '../../../tabulator/format/Progress.css';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { CATEGORY_THEME_KEY } from '../../timeline/themes/Themes.js';

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

const categoryKeys = [...new Set(Object.values(CATEGORY_THEME_KEY))];

/**
 * The category colour strip on the Name cell, and its tint when `category-colorize` is
 * set. The `--ct-color-*` theme properties come from the host, through the shadow root.
 */
const categories = css`
  ${unsafeCSS(
    categoryKeys
      .map((key) => `.row.cat-${key} { --row-cat-color: var(--ct-color-${key}); }`)
      .join('\n'),
  )}

  .body .row > .cell.tree {
    border-inline-start: var(--lana-space-xs) solid var(--row-cat-color, transparent);
  }

  :host([category-colorize]) .body .row > .cell.tree {
    background-color: color-mix(in srgb, var(--row-cat-color, transparent) 10%, transparent);
    color: var(--row-cat-color, inherit);
  }
`;

/** The class that colours a row by the category of its event. */
export function categoryClass(row: { originalData?: { category?: string } }): string | undefined {
  return eventCategoryClass(row.originalData ?? {});
}

/** {@link categoryClass} for a row that is the event itself. */
export function eventCategoryClass(event: { category?: string }): string | undefined {
  const key = event.category ? CATEGORY_THEME_KEY[event.category] : undefined;
  return key ? `cat-${key}` : undefined;
}

/**
 * `<lv-grid>` with the call-tree cell styles, the app theme and the category colours in
 * its shadow root.
 */
@customElement('lv-call-tree-grid')
export class CallTreeGrid<
  R extends { originalData?: { category?: string } } = { originalData?: { category?: string } },
> extends LvGrid<R> {
  static styles = [globalStyles, gridStyles, theme, cells, categories];

  /** Tints the Name cell with its category colour, as the `callTree.categoryColorize` setting asks. */
  @property({ type: Boolean, attribute: 'category-colorize', reflect: true })
  categoryColorize = false;

  constructor() {
    super();
    this.rowClass = categoryClass;
  }
}
