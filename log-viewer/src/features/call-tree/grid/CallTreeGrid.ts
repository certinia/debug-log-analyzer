/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { AppGrid } from '../../../components/grid/AppGrid.js';
import { CATEGORY_THEME_KEY } from '../../timeline/themes/Themes.js';

declare global {
  interface HTMLElementTagNameMap {
    'lv-call-tree-grid': CallTreeGrid;
  }
}

const cells = css`
  /* Log text keeps its line breaks, one variable per line in a STATIC_VARIABLE_LIST. */
  .cell.tree .content {
    white-space: pre-wrap;
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

/** `<lv-app-grid>` with the call-tree cell styles and the category colours in its shadow root. */
@customElement('lv-call-tree-grid')
export class CallTreeGrid<
  R extends { originalData?: { category?: string } } = { originalData?: { category?: string } },
> extends AppGrid<R> {
  static styles = [AppGrid.styles, cells, categories];

  /** Tints the Name cell with its category colour, as the `callTree.categoryColorize` setting asks. */
  @property({ type: Boolean, attribute: 'category-colorize', reflect: true })
  categoryColorize = false;

  constructor() {
    super();
    this.rowClass = categoryClass;
  }
}
