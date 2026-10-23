/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { DomListenerController } from '../core/events/DomListenerController.js';
import type { GridExpansion, LvGrid } from '../grid/index.js';

// styles
import { anchoredPopoverStyles } from '../styles/anchoredPopover.styles.js';
import { globalStyles } from '../styles/global.styles.js';
import { headerControlStyles } from '../styles/headerControl.styles.js';
import { menuRowStyles } from '../styles/menuRow.styles.js';

// web components
import '#vscode-elements/vscode-icon.js';

/** What the button needs of a grid. */
export type ExpandableGrid = HTMLElement &
  Pick<LvGrid, 'expansion' | 'expandLevel' | 'collapseLevel' | 'expandAll' | 'collapseAll'>;

/**
 * A tree grid's expand and collapse control, like the one on a VS Code tree view. Each
 * click opens one level until no row is closed, then closes one level until no row is
 * open. Its menu opens or closes the whole tree.
 */
@customElement('tree-expand-button')
export class TreeExpandButton extends LitElement {
  /** The grid to act on; null disables the button. */
  @property({ attribute: false })
  grid: ExpandableGrid | null = null;

  @state()
  private expanding = true;

  @state()
  private menuOpen = false;

  @query('#menu')
  private menu!: HTMLElement;

  @query('.more')
  private more!: HTMLElement;

  /** Each grid's own direction, so a view switched back to steps on the way it went. */
  private readonly directions = new WeakMap<ExpandableGrid, boolean>();

  /** The menu row a key opened the menu on, 0 or -1; a click focuses no row, as in VS Code. */
  private openAt: 0 | -1 | null = null;

  private readonly gridEvents = new DomListenerController<{
    'lv-grid-expansion-change': CustomEvent<GridExpansion>;
  }>(this, null, {
    'lv-grid-expansion-change': () => this.requestUpdate(),
  });

  static styles = [
    globalStyles,
    headerControlStyles,
    anchoredPopoverStyles,
    menuRowStyles,
    css`
      :host {
        display: inline-flex;
      }

      /* The filter bar's control, holding two buttons that each take their own hover. */
      .split {
        padding: 0;
        gap: 0;
        overflow: hidden;
        cursor: default;
      }

      .split:hover {
        background-image: none;
      }

      button.header-control {
        height: 100%;
        border: 0;
        border-radius: 0;
        padding: 0;
        background: none;
        font: inherit;
        cursor: pointer;
      }

      button.header-control:focus-visible {
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-inset);
      }

      button.header-control:disabled {
        color: var(--lana-fg-disabled);
        cursor: default;
        background: none;
      }

      /* VS Code's split actions keep the arrow half narrow. */
      .more {
        width: auto;
        padding: 0 var(--lana-space-3xs);
        border-left: var(--lana-stroke) solid var(--lana-control-border);
        anchor-name: --tree-expand-more;
      }

      .menu-row[aria-disabled='true'] {
        color: var(--lana-fg-disabled);
        cursor: default;
      }

      #menu:focus {
        outline: none;
      }

      #menu {
        position-anchor: --tree-expand-more;
        position-area: bottom span-left;
        margin: var(--lana-space-xs) 0 0 0;
        padding: var(--lana-space-xs);
      }
    `,
  ];

  private get expansion(): GridExpansion {
    return this.grid?.expansion ?? { canExpand: false, canCollapse: false };
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    const grid = this.grid;
    if (changed.has('grid')) {
      this.gridEvents.target = grid;
      this.expanding = (grid && this.directions.get(grid)) ?? true;
    }
    const { canExpand, canCollapse } = this.expansion;
    if (this.expanding ? !canExpand && canCollapse : !canCollapse && canExpand) {
      this.expanding = !this.expanding;
    }
    if (grid) {
      this.directions.set(grid, this.expanding);
    }
  }

  render() {
    const { canExpand, canCollapse } = this.expansion;
    const label = this.expanding ? 'Expand One Level' : 'Collapse One Level';
    const disabled = !canExpand && !canCollapse;
    return html`<span class="filter-control split">
        <button
          class="header-control"
          title=${label}
          aria-label=${label}
          ?disabled=${disabled}
          @click=${() =>
            void (this.expanding ? this.grid?.expandLevel() : this.grid?.collapseLevel())}
        >
          <vscode-icon name=${this.expanding ? 'expand-all' : 'collapse-all'}></vscode-icon>
        </button>
        <button
          class="header-control more"
          title="More Expand and Collapse Actions"
          aria-label="More Expand and Collapse Actions"
          aria-haspopup="menu"
          aria-controls="menu"
          aria-expanded=${String(this.menuOpen)}
          popovertarget="menu"
          ?disabled=${disabled}
          @click=${this.noteOpener}
          @keydown=${this.onMoreKey}
        >
          <vscode-icon name="chevron-down"></vscode-icon>
        </button>
      </span>
      <div
        id="menu"
        class="filter-popover popover-anchored"
        popover
        tabindex="-1"
        role="menu"
        aria-label="Expand and collapse"
        @toggle=${this.onToggle}
        @keydown=${this.onMenuKey}
      >
        <button
          class="filter-popover-row menu-row"
          role="menuitem"
          tabindex="-1"
          aria-disabled=${String(!canExpand)}
          @click=${() => {
            if (canExpand) {
              void this.all(true);
            }
          }}
        >
          <vscode-icon name="expand-all"></vscode-icon><span>Expand All</span>
        </button>
        <button
          class="filter-popover-row menu-row"
          role="menuitem"
          tabindex="-1"
          @click=${() => void this.all(false)}
        >
          <vscode-icon name="collapse-all"></vscode-icon><span>Collapse All</span>
        </button>
      </div>`;
  }

  /** Runs before `popovertarget` opens the menu. Enter or Space clicks with a detail of 0. */
  private noteOpener(event: MouseEvent): void {
    this.openAt = event.detail === 0 ? 0 : null;
  }

  private hideMenu(): void {
    // Optional calls: jsdom implements no popover API.
    this.menu.hidePopover?.();
  }

  /** The whole tree changed, so the keys and copy act on the grid next, as before. */
  private async all(expand: boolean): Promise<void> {
    this.hideMenu();
    const grid = this.grid;
    await (expand ? grid?.expandAll() : grid?.collapseAll());
    grid?.focus({ preventScroll: true });
  }

  private onToggle(event: ToggleEvent): void {
    this.menuOpen = event.newState === 'open';
    if (this.menuOpen) {
      (this.openAt === null ? this.menu : this.items().at(this.openAt))?.focus();
    }
    this.openAt = null;
  }

  private onMoreKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openAt = event.key === 'ArrowUp' ? -1 : 0;
      this.menu.showPopover?.();
    }
  }

  private onMenuKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      // Let focus move on, as out of any menu; the popover only closes itself on a click or Escape.
      this.hideMenu();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hideMenu();
      this.more.focus();
      return;
    }
    const items = this.items();
    const at = items.indexOf((this.renderRoot as ShadowRoot).activeElement as HTMLButtonElement);
    const next = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (Math.max(at, 0) - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  private items(): HTMLButtonElement[] {
    return [...this.menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tree-expand-button': TreeExpandButton;
  }
}
