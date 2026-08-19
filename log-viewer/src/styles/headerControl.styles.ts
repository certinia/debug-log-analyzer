/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * The header's bare icon buttons (log problems, notifications) and their corner count
 * badge. Shared so the two controls stay one visual family, and sized to match
 * `vscode-toolbar-button` so the Inspector toggle lines up with them.
 *
 * Chrome is monochrome: no severity colour here, on the glyph or the badge. VS Code's own
 * toolbar glyphs take `icon.foreground` and its activity-bar badge is the flat accent
 * whatever it counts; severity colour belongs to content rows (the panel's issue list, the
 * timeline), which is what `problemsErrorIcon.foreground` is for. Don't re-add a tint —
 * shape and count carry the severity here.
 */
export const headerControlStyles = css`
  .header-control {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    border-radius: 4px;
    color: var(--lana-fg);
  }

  .header-control:hover {
    background-color: var(--lana-toolbar-hover-bg);
  }

  /* Bottom-right, like the activity bar's — and clear of the header's top edge, which
     clipped a top-aligned badge. */
  .header-control__badge {
    position: absolute;
    bottom: -2px;
    right: -3px;
    box-sizing: border-box;
    min-width: 12px;
    height: 12px;
    padding: 0 2px;
    border-radius: 16px;
    background-color: var(--vscode-activityBarBadge-background);
    color: var(--vscode-activityBarBadge-foreground);
    font-size: 9px;
    font-weight: 600;
    line-height: 12px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
`;
