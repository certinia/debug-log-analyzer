/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, type TemplateResult } from 'lit';

/**
 * A polite live region a screen reader announces `text` from. Render it on every pass,
 * even with no text: a region added along with its first message is not announced.
 * The host's styles must carry `.sr-only` (`globalStyles`).
 */
export function liveStatus(text: string): TemplateResult {
  return html`<div class="sr-only" role="status" aria-live="polite">${text}</div>`;
}
