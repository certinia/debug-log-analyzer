/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, type TemplateResult } from 'lit';
import { CLASS_BY_KIND, escapeHtml, renderInline } from './renderInline.js';
import { prettyChunks, renderPretty } from './renderPretty.js';
import { detectDialect, tokenize, type Dialect, type Token } from './tokenize.js';

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

/**
 * Lit-template variant of {@link formatSOQL}. Returns a `TemplateResult` whose
 * spans are real Lit-managed nodes, so callers don't need `unsafeHTML` (which
 * re-parses an HTML string on every render). Lit caches the per-token
 * `<span class=${cls}>${text}</span>` template and diffs only the dynamic
 * class/text values.
 */
export function formatSOQLToTemplate(text: string, opts: FormatOptions): TemplateResult {
  if (!text) {
    return html`${nothing}`;
  }
  try {
    const dialect: Dialect =
      !opts.dialect || opts.dialect === 'auto' ? detectDialect(text) : opts.dialect;
    const tokens = tokenize(text, dialect);
    const chunks: (Token | string)[] = opts.mode === 'pretty' ? prettyChunks(tokens) : tokens;
    return html`${chunks.map(chunkToTemplate)}`;
  } catch {
    return html`${text}`;
  }
}

function chunkToTemplate(c: Token | string): TemplateResult | string {
  if (typeof c === 'string') {
    return c;
  }
  const cls = CLASS_BY_KIND[c.kind];
  return cls ? html`<span class=${cls}>${c.text}</span>` : c.text;
}

export type { Dialect } from './tokenize.js';
