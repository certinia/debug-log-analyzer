/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { TextEncoder } from 'node:util';

/**
 * jsdom implements no layout, so it ships no `ResizeObserver` either. Components that observe
 * their own size construct one on connect, so without this every such suite throws before it can
 * assert anything. A suite that needs to *drive* resizes replaces this with its own stub.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = NoopResizeObserver;
}

/**
 * jsdom ships no `TextEncoder`, which the parser uses to size a log in UTF-8 bytes. Node's is the
 * same WHATWG class, so handing it over costs nothing.
 */
if (!('TextEncoder' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).TextEncoder = TextEncoder;
}
