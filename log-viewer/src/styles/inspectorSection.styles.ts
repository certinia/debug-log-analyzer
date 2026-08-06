/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/** Shared chrome for an inspector chart section: the host box and the muted
 *  "nothing to draw" note. */
export const inspectorSectionStyles = css`
  /* No padding of its own: the pane body owns it, so every section shares one
     content edge. */
  :host {
    display: block;
  }

  .note {
    color: var(--lana-fg-muted);
    font-size: var(--lana-text-sm);
  }
`;
