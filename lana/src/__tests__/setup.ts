/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Jest setup file for lana tests.
 * Auto-injects vscode mock and resets state between tests.
 */

import { resetMocks } from './mocks/vscode.js';

// Reset mock state before each test
beforeEach(() => {
  resetMocks();
});

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});
