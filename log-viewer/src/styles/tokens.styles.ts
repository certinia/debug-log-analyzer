/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { unsafeCSS } from 'lit';

import tokensCss from './tokens.css';

/**
 * The `--lana-*` set as adoptable styles, for a component whose CSS names a token.
 * Importing this also injects the document-level copy (see
 * `scripts/rollup-plugin-css.mjs`), which a component that reads a token without
 * adopting the tokens inherits.
 */
export const tokenStyles = unsafeCSS(tokensCss);
