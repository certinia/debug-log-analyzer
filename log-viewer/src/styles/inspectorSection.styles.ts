/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/** Shared chrome for an inspector chart section: the host box and the muted
 *  "nothing to draw" note. */
export const inspectorSectionStyles = css`
  :host {
    display: block;
    /* Left inset lines the content up with the other sections' text. */
    padding: var(--lana-space-sm) var(--lana-space-md) var(--lana-space-md)
      var(--lana-section-inset);
  }

  .note {
    color: var(--lana-fg-muted);
    font-size: var(--lana-text-sm);
  }
`;
