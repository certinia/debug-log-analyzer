/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, type TemplateResult } from 'lit';
import { budgetedChunks, type SoqlBudget } from './budget.js';
import { CLASS_BY_KIND, escapeHtml, renderInline } from './renderInline.js';
import { prettyChunks, renderPretty } from './renderPretty.js';
import { detectDialect, tokenize, type Dialect, type Token } from './tokenize.js';

export interface FormatOptions {
  mode: 'inline' | 'pretty';
  dialect?: Dialect | 'auto';
  /**
   * `pretty` only. Fit the query into this many lines and columns, keeping one
   * line per clause and counting what each clause leaves out.
   */
  budget?: SoqlBudget;
}

export function formatSOQL(text: string, opts: FormatOptions): string {
  if (!text) {
    return '';
  }
  try {
    const dialect = resolveDialect(text, opts);
    const tokens = tokenize(text, dialect);
    if (opts.mode !== 'pretty') {
      return renderInline(tokens);
    }
    if (!opts.budget) {
      return renderPretty(tokens);
    }
    return chunksToHtml(budgetedChunks(tokens, opts.budget));
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
    return html`${chunksFor(text, opts).map(chunkToTemplate)}`;
  } catch {
    return html`${text}`;
  }
}

function chunksFor(text: string, opts: FormatOptions): (Token | string)[] {
  const tokens = tokenize(text, resolveDialect(text, opts));
  if (opts.mode !== 'pretty') {
    return tokens;
  }
  return opts.budget ? budgetedChunks(tokens, opts.budget) : prettyChunks(tokens);
}

function resolveDialect(text: string, opts: FormatOptions): Dialect {
  return !opts.dialect || opts.dialect === 'auto' ? detectDialect(text) : opts.dialect;
}

function chunksToHtml(chunks: (Token | string)[]): string {
  let out = '';
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      out += chunk;
      continue;
    }
    const cls = CLASS_BY_KIND[chunk.kind];
    const escaped = escapeHtml(chunk.text);
    out += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
  }
  return out;
}

function chunkToTemplate(c: Token | string): TemplateResult | string {
  if (typeof c === 'string') {
    return c;
  }
  const cls = CLASS_BY_KIND[c.kind];
  return cls ? html`<span class=${cls}>${c.text}</span>` : c.text;
}

export type { SoqlBudget } from './budget.js';
export type { Dialect } from './tokenize.js';
