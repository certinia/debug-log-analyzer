/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';

/**
 * Compact chip styled as a resting VS Code dropdown face (1px border, 4px radius, dropdown
 * tokens). Two slots: `lead` for the label naming the value, and the default slot for the
 * value itself. Presentational only — no interactivity.
 *
 * The host is the face and carries the type — mono for both slots; the `lead` slot recedes
 * via `::slotted`.
 */
@customElement('vs-chip')
export class VsChip extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: baseline;
        gap: var(--lana-space-xs);
        padding: var(--lana-space-3xs) var(--lana-space-xs);
        border: var(--lana-stroke) solid var(--lana-control-border);
        border-radius: var(--lana-radius-sm);
        background-color: var(--lana-control-bg);
        white-space: nowrap;
        /* Label and value both mono, like the log text they name: the chips sit in
           a row, so one family keeps their heights and stems matched. */
        font-family: var(--lana-font-mono);
        font-weight: 600;
        /* Both slots come out of the log all caps, so every glyph reaches cap
           height: a step below the app's base size keeps the chip level with the
           mixed-case text beside it instead of towering over it. */
        font-size: var(--lana-text-xs);
        color: var(--lana-fg);
      }

      /* The leading label names what the value belongs to, so it recedes — same
         size, lighter and dimmer. */
      ::slotted([slot='lead']) {
        font-weight: 400;
        color: var(--lana-fg-muted);
      }
    `,
  ];

  render() {
    return html`<slot name="lead"></slot><slot></slot>`;
  }
}
