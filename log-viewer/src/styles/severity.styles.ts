/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

import type { Severity } from '../features/soql/services/SOQLLinter.js';

/** The codicon VS Code marks a Problems row of this severity with. */
export function severityIcon(severity: Severity): string {
  switch (severity.toLowerCase()) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * Colours for `class="sev-<severity>"`, where the severity is lower case. For a
 * mark only: an icon, a border, a tint, a bar fill, where 3:1 applies. Text
 * keeps the theme foreground, since these hues are tuned for a glyph and a
 * light theme can read one at 2:1 as a word.
 */
export const severityStyles = css`
  .sev-error {
    color: var(--lana-severity-error);
  }
  .sev-warning {
    color: var(--lana-severity-warning);
  }
  .sev-info {
    color: var(--lana-severity-info);
  }
  .sev-ok {
    color: var(--lana-severity-ok);
  }
`;
