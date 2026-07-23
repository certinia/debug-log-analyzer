/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';

/**
 * Spacing + radius scale shared by the database detail-panel components
 * (DetailDock / PaneView / DbVitals / CodeBlock). Declared on `:host` so each
 * shadow root resolves the tokens. Scoped to the side-panel feature — not part
 * of the app-wide global styles.
 */
export const panelTokens = css`
  :host {
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --panel-radius: 4px;
    /* Shared height for the dock action bar and pane section headers. */
    --panel-header-height: var(--space-6);
  }
`;
