/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
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

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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
}

/**
 * Context menu component styled to match VS Code's native menus.
 *
 * @fires menu-select - Fired when a menu item is selected. Detail: { itemId: string }
 * @fires menu-close - Fired when the menu is closed (click outside, Escape, or after selection)
 */
@customElement('context-menu')
export class ContextMenu extends LitElement {
  static styles = css`
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
      padding: 6px 0;
      background-color: var(--vscode-menu-background, #252526);
      border: 1px solid var(--vscode-menu-border, #454545);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: 13px;
      color: var(--vscode-menu-foreground, #cccccc);
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
      background-color: var(--vscode-menu-selectionBackground, #094771);
      color: var(--vscode-menu-selectionForeground, #ffffff);
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

    .separator {
      height: 1px;
      margin: 6px 12px;
      background-color: var(--vscode-menu-separatorBackground, #454545);
    }
  `;

  @property({ type: Array }) items: ContextMenuItem[] = [];
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @state() private _visible = false;

  private boundHandleClickOutside = this.handleClickOutside.bind(this);
  private boundHandleKeyDown = this.handleKeyDown.bind(this);

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
    this.hide();
    this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
  }

  private adjustPosition(): void {
    const menu = this.shadowRoot?.querySelector('.menu') as HTMLElement;
    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust horizontal position if menu goes off right edge
    if (this.x + rect.width > viewportWidth) {
      const newLeft = Math.max(0, viewportWidth - rect.width - 8);
      this.style.left = `${newLeft}px`;
    }

    // Adjust vertical position if menu goes off bottom edge
    if (this.y + rect.height > viewportHeight) {
      const newTop = Math.max(0, viewportHeight - rect.height - 8);
      this.style.top = `${newTop}px`;
    }
  }

  render() {
    if (!this._visible) {
      return nothing;
    }

    return html`
      <div class="menu" role="menu">${this.items.map((item) => this.renderItem(item))}</div>
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
        <span class="label">${item.label}</span>
        ${item.shortcut ? html`<span class="shortcut">${item.shortcut}</span>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'context-menu': ContextMenu;
  }
}
