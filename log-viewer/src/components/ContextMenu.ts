/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * ContextMenu - Reusable context menu Lit component
 *
 * A lightweight context menu styled to match VS Code's native appearance.
 * Uses Shadow DOM for style encapsulation and works in VS Code webview CSP.
 *
 * Usage:
 * ```html
 * <context-menu
 *   @menu-select="${(e) => handleSelect(e.detail.itemId)}"
 *   @menu-close="${() => handleClose()}"
 * ></context-menu>
 * ```
 *
 * ```typescript
 * const menu = document.querySelector('context-menu');
 * menu.show([
 *   { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
 *   { id: 'sep', label: '', separator: true },
 *   { id: 'delete', label: 'Delete', disabled: true }
 * ], clientX, clientY);
 * ```
 */

import '#vscode-elements/vscode-icon.js';

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';

/** Gutter kept between the menu and the viewport edges (px). Shared by the CSS
 *  height cap and the off-screen position clamp so a shifted menu still fits. */
const GUTTER = 12;

export interface ContextMenuItem {
  /** Unique identifier for the menu item */
  id: string;
  /** Display label */
  label: string;
  /** Optional keyboard shortcut hint (display only) */
  shortcut?: string;
  /** If true, renders a separator line instead of a clickable item */
  separator?: boolean;
  /** If true, the item is grayed out and not clickable */
  disabled?: boolean;
  /** If true, selecting the item (or its action) leaves the menu open (multi-toggle). */
  keepOpen?: boolean;
  /**
   * If set, renders a real `.vs-checkbox` in place of the label's checkmark
   * glyph — for multiselect rows (e.g. per-column visibility toggles). Leave
   * unset for single-select rows (view presets), which keep the checkmark.
   */
  checked?: boolean;
  /**
   * Optional trailing action icon (e.g. per-row reset). Clicking it emits
   * `menu-select` with `action.id` instead of the row's own id.
   */
  action?: { id: string; icon: string; title: string };
}

/**
 * Context menu component styled to match VS Code's native menus.
 *
 * @fires menu-select - Fired when a menu item is selected. Detail: { itemId: string }
 * @fires menu-close - Fired when the menu is closed (click outside, Escape, or after selection)
 */
@customElement('context-menu')
export class ContextMenu extends LitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        position: fixed;
        z-index: 10000;
        display: none;
      }

      :host([visible]) {
        display: block;
      }

      .menu {
        min-width: 180px;
        /* Never exceed the viewport (leave a gutter top + bottom); scroll the
           overflow so every field stays reachable on a short screen. border-box
           keeps the padding inside the cap; keep the 24px (2 * GUTTER) in sync
           with the constant used by adjustPosition(). */
        box-sizing: border-box;
        max-height: calc(100vh - 24px);
        overflow-y: auto;
        padding: 6px 0;
        font-size: var(--filter-popover-row-font-size);
        outline: none;
      }

      .menu-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 20px 6px 12px;
        cursor: pointer;
        user-select: none;
        border-radius: 4px;
        margin: 0 6px;
      }

      .menu-item:hover:not(.disabled) {
        background-color: var(--lana-row-hover-bg);
      }

      .menu-item.disabled {
        color: var(--vscode-disabledForeground, #6e6e6e);
        cursor: default;
      }

      .label {
        flex: 1;
      }

      .shortcut {
        margin-left: 32px;
        opacity: 0.7;
        font-size: 12px;
      }

      .item-action {
        margin-left: 12px;
        opacity: 0.7;
      }

      .item-action:hover {
        opacity: 1;
      }

      /* Purely visual — the row's own click handles the toggle. */
      .menu-item .vs-checkbox {
        margin-right: 8px;
        pointer-events: none;
      }

      .separator {
        height: 1px;
        margin: 6px 12px;
        background-color: var(--vscode-menu-separatorBackground, #454545);
      }
    `,
  ];

  @property({ type: Array }) items: ContextMenuItem[] = [];
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @state() private _visible = false;

  private boundHandleClickOutside = this.handleClickOutside.bind(this);
  private boundHandleKeyDown = this.handleKeyDown.bind(this);
  /** Re-clamp the open menu when the window/webview resizes so it can't drift off-screen. */
  private boundHandleResize = (): void => this.adjustPosition();

  /**
   * Show the context menu at the specified screen coordinates.
   */
  public show(items: ContextMenuItem[], x: number, y: number): void {
    // Hide any existing menu first
    this.hide();

    this.items = items;
    this.x = x;
    this.y = y;
    this._visible = true;

    // Add visible attribute for CSS
    this.setAttribute('visible', '');

    // Position the menu
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;

    // Add event listeners (on next tick to avoid catching the triggering click)
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', this.boundHandleClickOutside, true);
      document.addEventListener('keydown', this.boundHandleKeyDown, true);
      window.addEventListener('resize', this.boundHandleResize);

      // Adjust position if menu goes off-screen (after render)
      this.updateComplete.then(() => this.adjustPosition());

      // Focus the menu for keyboard navigation
      this.shadowRoot?.querySelector('.menu')?.setAttribute('tabindex', '-1');
      (this.shadowRoot?.querySelector('.menu') as HTMLElement)?.focus();
    });
  }

  /**
   * Hide and close the context menu.
   */
  public hide(): void {
    if (!this._visible) {
      return;
    }

    document.removeEventListener('mousedown', this.boundHandleClickOutside, true);
    document.removeEventListener('keydown', this.boundHandleKeyDown, true);
    window.removeEventListener('resize', this.boundHandleResize);

    this._visible = false;
    this.removeAttribute('visible');
    this.items = [];
  }

  /**
   * Check if the menu is currently visible.
   */
  public isVisible(): boolean {
    return this._visible;
  }

  private handleClickOutside(e: MouseEvent): void {
    // Check if click is outside the menu
    const path = e.composedPath();
    if (!path.includes(this)) {
      this.hide();
      this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
      this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
    }
  }

  private handleItemClick(item: ContextMenuItem): void {
    if (item.disabled) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent('menu-select', {
        detail: { itemId: item.id },
        bubbles: true,
        composed: true,
      }),
    );
    if (!item.keepOpen) {
      this.hide();
      this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
    }
  }

  private handleActionClick(event: Event, actionId: string, keepOpen?: boolean): void {
    // Keep the click from triggering the row's own select.
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('menu-select', {
        detail: { itemId: actionId },
        bubbles: true,
        composed: true,
      }),
    );
    if (!keepOpen) {
      this.hide();
      this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
    }
  }

  private adjustPosition(): void {
    const menu = this.shadowRoot?.querySelector('.menu') as HTMLElement;
    if (!menu) {
      return;
    }

    // Reset to the anchor first so repeated calls (e.g. on resize) re-clamp from
    // the original point rather than compounding a previous shift.
    this.style.left = `${this.x}px`;
    this.style.top = `${this.y}px`;

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust horizontal position if menu goes off right edge
    if (this.x + rect.width > viewportWidth) {
      const newLeft = Math.max(GUTTER, viewportWidth - rect.width - GUTTER);
      this.style.left = `${newLeft}px`;
    }

    // Adjust vertical position if menu goes off bottom edge. The CSS max-height
    // caps rect.height at viewportHeight - 2*GUTTER, so this always fits.
    if (this.y + rect.height > viewportHeight) {
      const newTop = Math.max(GUTTER, viewportHeight - rect.height - GUTTER);
      this.style.top = `${newTop}px`;
    }
  }

  render() {
    if (!this._visible) {
      return nothing;
    }

    return html`
      <div class="filter-popover menu" role="menu">
        ${this.items.map((item) => this.renderItem(item))}
      </div>
    `;
  }

  private renderItem(item: ContextMenuItem) {
    if (item.separator) {
      return html`<div class="separator" role="separator"></div>`;
    }

    return html`
      <div
        class="menu-item ${item.disabled ? 'disabled' : ''}"
        role="menuitem"
        data-id="${item.id}"
        @click="${() => this.handleItemClick(item)}"
      >
        ${
          item.checked !== undefined
            ? html`<input
                type="checkbox"
                class="vs-checkbox"
                tabindex="-1"
                .checked="${item.checked}"
              />`
            : nothing
        }
        <span class="label">${item.label}</span>
        ${item.shortcut ? html`<span class="shortcut">${item.shortcut}</span>` : nothing}
        ${
          item.action
            ? html`<vscode-icon
                name="${item.action.icon}"
                action-icon
                class="item-action"
                title="${item.action.title}"
                @click="${(event: Event) =>
                  this.handleActionClick(event, item.action!.id, item.keepOpen)}"
              ></vscode-icon>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'context-menu': ContextMenu;
  }
}
