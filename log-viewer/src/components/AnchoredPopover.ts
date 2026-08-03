/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// web components
import '#vscode-elements/vscode-icon.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

/**
 * Trigger + panel pair for the header's drop-downs: renders the slotted trigger and
 * shows the `panel` slot in a native popover anchored to it.
 *
 * Native `popover` (rather than a `position: absolute` div) buys two things the
 * hand-rolled panels didn't have: the panel lives in the top layer so no ancestor
 * `overflow` can clip it, and light-dismiss (click-outside + `Escape`) comes for
 * free — no `document` click listener to add, leak or get wrong.
 *
 * Opens on click only. These panels contain links and navigation buttons, so a
 * hover-opened panel would be a trap.
 */
@customElement('anchored-popover')
export class AnchoredPopover extends LitElement {
  /** Panel `aria-label`; rendered as a visible heading only with `show-heading`. */
  @property()
  heading = '';

  /** Show `heading` at the top of the panel. Off for menus — VS Code's are untitled. */
  @property({ attribute: 'show-heading', type: Boolean })
  showHeading = false;

  /** Which side the panel aligns to. */
  @property()
  align: 'start' | 'end' = 'end';

  /** Shown in place of the `panel` slot when it has no content. */
  @property({ attribute: 'empty-message' })
  emptyMessage = '';

  /** Queried live rather than cached: the slot's content changes without a re-render. */
  private get _panelContent(): readonly Element[] {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="panel"]');
    return slot?.assignedElements({ flatten: true }) ?? [];
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }

      .trigger {
        display: inline-flex;
        /* The popover positions against this, so it must be the anchor rather than
           :host — a display:contents/inline-flex host has no usable anchor box. */
        anchor-name: --anchored-popover-trigger;
        border: 0;
        padding: 0;
        margin: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .panel {
        position: fixed;
        position-anchor: --anchored-popover-trigger;
        /* Flip above / to the other side rather than running off-screen: the header
           sits at the top of a panel that can be docked at either edge. */
        position-try-fallbacks:
          flip-block,
          flip-inline,
          flip-block flip-inline;
        inset: auto;
        margin: 6px 0 0 0;
        box-sizing: border-box;
        width: 320px;
        max-width: min(92vw, 320px);
        max-height: 540px;
        overflow-y: auto;
        padding: 6px;
        /* Panel content sets its own alignment — never inherit one from the header row. */
        text-align: start;
      }

      :host([align='end']) .panel {
        position-area: bottom span-left;
      }

      :host([align='start']) .panel {
        position-area: bottom span-right;
      }

      .panel__head {
        padding: 2px 8px 6px;
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-foreground);
      }

      .panel__empty {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      /* Hidden until the slot reports content, so the empty message shows instead. */
      .panel__items--empty {
        display: none;
      }
    `,
  ];

  render() {
    // Emptiness is read from the slot, which doesn't exist on the first render — the
    // firstUpdated/slotchange re-render settles it. No flash: the panel stays closed
    // until the trigger is clicked.
    const isEmpty = this._panelContent.length === 0;

    return html`<button
        part="trigger"
        class="trigger"
        popovertarget="anchored-popover-panel"
        aria-haspopup="true"
        aria-controls="anchored-popover-panel"
      >
        <slot name="trigger"></slot>
      </button>
      <div
        part="panel"
        class="panel filter-popover"
        id="anchored-popover-panel"
        popover
        role="group"
        aria-label=${this.heading}
      >
        ${
          this.showHeading && this.heading
            ? html`<div class="panel__head">${this.heading}</div>`
            : ''
        }
        <div class=${isEmpty ? 'panel__items--empty' : ''}>
          <slot name="panel" @slotchange=${this._onSlotChange}></slot>
        </div>
        ${
          isEmpty && this.emptyMessage
            ? html`<div class="panel__empty">
                <vscode-icon name="pass" size="16"></vscode-icon>
                <span>${this.emptyMessage}</span>
              </div>`
            : ''
        }
      </div>`;
  }

  /**
   * Dismiss the panel. Light-dismiss covers clicks *outside*, so a command row inside
   * the panel has to close it explicitly or it stays open over whatever it just did.
   */
  close(): void {
    const panel = this.shadowRoot?.querySelector<HTMLElement>('.panel');
    // No-op under jsdom, which implements neither `hidePopover` nor `:popover-open`.
    if (typeof panel?.hidePopover === 'function' && panel.matches(':popover-open')) {
      panel.hidePopover();
    }
  }

  /** The slot only reports its content once it exists, so settle the empty state here. */
  override firstUpdated(): void {
    this.requestUpdate();
  }

  private _onSlotChange(): void {
    this.requestUpdate();
  }
}
