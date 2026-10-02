/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Stands in for a `#vscode-elements` import under vitest. Those modules register a custom element
 * on load, and their `connectedCallback` reaches for browser APIs jsdom does not implement. A
 * component that imports one only needs the tag to exist as an inert element, which an
 * un-upgraded one already is.
 */
export {};
