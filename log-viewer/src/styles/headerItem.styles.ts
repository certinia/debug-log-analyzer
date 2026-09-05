/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * The header's muted metadata idiom, shared by `log-meta` and `log-identity` so
 * the two clusters cannot drift apart in size or colour. Hosts using it must
 * also carry the tokens (`globalStyles` or `tokenStyles`).
 */
export const headerItemStyles = css`
  :host {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    font-size: var(--lana-text-meta);
    color: var(--lana-fg-muted);
  }
`;
