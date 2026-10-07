/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * The grid's look. A host themes it only through the `--grid-*` properties; the defaults
 * are CSS system colours, which follow the host's light or dark scheme.
 */
export const gridStyles = css`
  @layer grid {
    :host {
      --grid-bg: Canvas;
      --grid-fg: CanvasText;
      --grid-muted-fg: GrayText;
      --grid-border: color-mix(in srgb, GrayText 35%, transparent);
      --grid-header-bg: var(--grid-bg);
      --grid-hover-bg: color-mix(in srgb, GrayText 15%, transparent);
      --grid-selected-bg: Highlight;
      --grid-selected-fg: HighlightText;
      --grid-marked-bg: var(--grid-hover-bg);
      --grid-focus: Highlight;
      --grid-find-bg: color-mix(in srgb, Mark 55%, transparent);
      --grid-find-current-bg: Mark;
      --grid-font: inherit;
      --grid-font-size: inherit;
      --grid-tree-font: var(--grid-font);
      --grid-pad: 4px;
      --grid-indent: 9px;
      --grid-twisty: 16px;
      --grid-stroke: 1px;
      --grid-resize: 6px;

      display: block;
      height: 100%;
      min-height: 0;
      color: var(--grid-fg);
      background: var(--grid-bg);
      font-family: var(--grid-font);
      font-size: var(--grid-font-size);
    }

    .scroller {
      position: relative;
      height: 100%;
      overflow: auto;
      contain: strict;
      overflow-anchor: none;
      outline: none;

      &:focus-visible {
        box-shadow: inset 0 0 0 var(--grid-stroke) var(--grid-focus);
      }
    }

    .row {
      display: grid;
      grid-template-columns: var(--grid-cols);
      min-width: var(--grid-min-width);
    }

    .head,
    .foot {
      --grid-row-bg: var(--grid-header-bg);

      position: sticky;
      /* Above the frozen cells of the body rows. */
      z-index: 2;
      background: var(--grid-row-bg);
      font-weight: bold;
    }

    .head {
      top: 0;
      border-block-end: var(--grid-stroke) solid var(--grid-border);
    }

    .foot {
      bottom: 0;
      border-block-start: var(--grid-stroke) solid var(--grid-border);
    }

    .body {
      position: relative;

      & .row {
        --grid-row-bg: transparent;

        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        width: 100%;
        background: var(--grid-row-bg);

        &:hover {
          --grid-row-bg: var(--grid-hover-bg);
        }

        &.marked {
          --grid-row-bg: var(--grid-marked-bg);
        }

        &[aria-selected='true'] {
          --grid-row-bg: var(--grid-selected-bg);

          color: var(--grid-selected-fg);
        }
      }

      & .group {
        font-family: var(--grid-tree-font);
        cursor: pointer;
      }
    }

    .cell {
      min-width: 0;
      padding: var(--grid-pad);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;

      &.end {
        text-align: end;
        font-variant-numeric: tabular-nums;
      }

      &.tree {
        padding-inline-start: calc(var(--grid-pad) + var(--grid-depth, 0) * var(--grid-indent));
        font-family: var(--grid-tree-font);
        white-space: normal;
        overflow-wrap: anywhere;
      }
    }

    /* The row colour over the grid's own, so scrolled cells do not show through. */
    :host([freeze-first]) .row > .cell:first-child {
      position: sticky;
      inset-inline-start: 0;
      z-index: 1;
      background: linear-gradient(var(--grid-row-bg), var(--grid-row-bg)), var(--grid-bg);
      box-shadow: inset calc(-1 * var(--grid-stroke)) 0 var(--grid-border);
    }

    .colhead {
      position: relative;
      display: flex;
      align-items: end;
      gap: var(--grid-pad);
      white-space: normal;

      &.end {
        justify-content: end;
        text-align: end;
      }

      &[data-sortable] {
        cursor: pointer;
        user-select: none;
      }

      &[aria-sort='ascending']::after,
      &[aria-sort='descending']::after {
        content: '';
        flex: none;
        align-self: center;
        border-inline: 4px solid transparent;
      }

      &[aria-sort='ascending']::after {
        border-block-end: 6px solid currentColor;
      }

      &[aria-sort='descending']::after {
        border-block-start: 6px solid currentColor;
      }
    }

    .resize {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      width: var(--grid-resize);
      cursor: col-resize;
      touch-action: none;

      &:hover {
        background: var(--grid-border);
      }
    }

    .twisty {
      display: inline-block;
      width: var(--grid-twisty);
      vertical-align: middle;
      cursor: pointer;
      text-align: center;

      &.closed::before,
      &.open::before {
        content: '';
        display: inline-block;
        border-block: 4px solid transparent;
        border-inline-start: 6px solid currentColor;
        transition: rotate 0.1s;
      }

      &.open::before {
        rotate: 90deg;
      }
    }

    .busy {
      position: sticky;
      top: 0;
      z-index: 3;
      height: 2px;
      margin-block-end: -2px;
      background: var(--grid-focus);
      opacity: 0;
    }

    /* Only a step that runs past 100ms shows it. */
    :host([busy]) .busy {
      animation: grid-busy 0s 0.1s forwards;
    }

    @keyframes grid-busy {
      to {
        opacity: 1;
      }
    }

    ::highlight(find-match) {
      background-color: var(--grid-find-bg);
    }

    ::highlight(current-find-match) {
      background-color: var(--grid-find-current-bg);
    }
  }
`;
