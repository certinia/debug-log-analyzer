/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { resetMocks } from './mocks/vscode.js';

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});
