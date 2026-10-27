/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { bareAddress } from '../variableLine.js';

describe('addresses', () => {
  it('reads a value that is only an address', () => {
    expect(bareAddress('0xd854c6b')).toBe('0xd854c6b');
    expect(bareAddress(' 0xd854c6b ')).toBe('0xd854c6b');
    expect(bareAddress('{"a":1}')).toBeNull();
    expect(bareAddress('42')).toBeNull();
  });
});
