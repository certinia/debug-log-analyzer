/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { escapeHtml, renderInline } from './renderInline.js';
import { renderPretty } from './renderPretty.js';
import { detectDialect, tokenize, type Dialect } from './tokenize.js';

export interface FormatOptions {
  mode: 'inline' | 'pretty';
  dialect?: Dialect | 'auto';
}

export function formatSOQL(text: string, opts: FormatOptions): string {
  if (!text) {
    return '';
  }
  try {
    const dialect: Dialect =
      !opts.dialect || opts.dialect === 'auto' ? detectDialect(text) : opts.dialect;
    const tokens = tokenize(text, dialect);
    return opts.mode === 'pretty' ? renderPretty(tokens) : renderInline(tokens);
  } catch {
    return escapeHtml(text);
  }
}

export type { Dialect } from './tokenize.js';
