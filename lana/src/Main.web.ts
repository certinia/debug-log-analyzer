/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// Browser (web) entry point. Platform differences (filesystem, org connection)
// are absorbed by the salesforcedx-vscode-services layer, so activation is
// identical to desktop — this simply re-exports the shared entry points.
export { activate, context, deactivate } from './Main.js';
