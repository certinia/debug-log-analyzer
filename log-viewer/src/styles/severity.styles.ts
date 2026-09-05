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

/** Colours for `class="sev-<severity>"`, where the severity is lower case. */
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
