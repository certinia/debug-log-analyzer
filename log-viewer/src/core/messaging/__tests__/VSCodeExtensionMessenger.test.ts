/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it, jest } from '@jest/globals';

import { VSCodeExtensionMessenger } from '../VSCodeExtensionMessenger.js';

describe('VSCodeExtensionMessenger.listen', () => {
  it('ignores malformed window messages', () => {
    const callback = jest.fn();
    const stop = VSCodeExtensionMessenger.listen(callback);

    for (const data of [
      undefined,
      null,
      'message',
      [],
      {},
      { cmd: 3 },
      { cmd: 'valid', requestId: 3 },
    ]) {
      window.dispatchEvent(new MessageEvent('message', { data }));
    }

    expect(callback).not.toHaveBeenCalled();
    stop();
  });

  it('passes validated window messages to the listener', () => {
    const callback = jest.fn();
    const stop = VSCodeExtensionMessenger.listen(callback);

    window.dispatchEvent(
      new MessageEvent('message', { data: { cmd: 'configChanged', payload: {} } }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    stop();
  });
});
