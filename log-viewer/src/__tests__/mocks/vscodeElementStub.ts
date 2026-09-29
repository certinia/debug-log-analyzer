/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Stands in for a `#vscode-elements/*` import under jest. The real modules register custom
 * elements jsdom cannot construct, and an importer only needs the tag to exist in its
 * template — an unregistered tag renders as an unknown element and loses no coverage.
 */
export {};
