/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { readFile } from 'node:fs/promises';

/**
 * @param {{ sources: Record<string, { path: string, encoding?: 'base64' | 'utf8' }> }} options
 * @returns {import('rollup').Plugin}
 */
export default function text({ sources }) {
  const prefix = '\0lana-text:';
  return {
    name: 'lana-text',

    resolveId(id) {
      return Object.hasOwn(sources, id) ? `${prefix}${id}` : null;
    },

    async load(id) {
      if (!id.startsWith(prefix)) {
        return null;
      }

      const source = sources[id.slice(prefix.length)];
      if (!source) {
        return null;
      }

      this.addWatchFile(source.path);
      const content = await readFile(source.path);
      const value = content.toString(source.encoding ?? 'utf8');
      return {
        code: `export default ${JSON.stringify(value)};`,
        moduleSideEffects: false,
      };
    },
  };
}
