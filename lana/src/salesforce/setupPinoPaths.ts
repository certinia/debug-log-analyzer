/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Sets up pino bundler path overrides for worker threads.
 * Must be called before any @salesforce/* imports that use pino.
 *
 * Pino uses worker threads that need to load files from disk at runtime.
 * When bundled with rollup, the paths break. This injects the correct
 * paths to the separately copied worker files.
 */
export function setupPinoBundlerPaths(): void {
  if ('__bundlerPathsOverrides' in globalThis) return;

  const __dirname = dirname(fileURLToPath(import.meta.url));

  (globalThis as Record<string, unknown>).__bundlerPathsOverrides = {
    'thread-stream-worker': join(__dirname, 'thread-stream-worker.js'),
    'pino-worker': join(__dirname, 'pino-worker.js'),
    'pino/file': join(__dirname, 'pino-file.js'),
    '../../lib/logger/transformStream': join(__dirname, 'salesforce-transform-stream.js'),
  };
}
