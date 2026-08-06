/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * Layout half of a header-menu row. Pair with `.filter-popover-row` from
 * `global.styles.ts`, which owns the look (padding, radius, hover) — that class is
 * look-only, so every consumer supplies its own layout.
 *
 * Shared rather than copied because both `<header-menu>` and `<nav-bar>` render rows
 * into the same menu and must present one face.
 */
export const menuRowStyles = css`
  .menu-row {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    gap: 8px;
    background: none;
    border: 0;
    color: inherit;
    /* Kills the UA button font, so restate the row's own size. */
    font: inherit;
    font-size: var(--filter-popover-row-font-size);
    text-align: left;
    cursor: pointer;
  }

  /* globalStyles' a:hover (0,1,1) outranks .menu-row (0,1,0), so a row that happens
     to be a link would render blue and underlined next to an identical button. A menu
     row is a menu row — the hover background is the only affordance. */
  a.menu-row,
  a.menu-row:hover,
  a.menu-row:active {
    color: inherit;
    text-decoration: none;
  }
`;
