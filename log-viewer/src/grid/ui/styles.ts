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
      position: sticky;
      z-index: 1;
      background: var(--grid-header-bg);
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
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        width: 100%;

        &:hover {
          background: var(--grid-hover-bg);
        }

        &.marked {
          background: var(--grid-marked-bg);
        }

        &[aria-selected='true'] {
          background: var(--grid-selected-bg);
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

    .colhead {
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
      z-index: 2;
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
