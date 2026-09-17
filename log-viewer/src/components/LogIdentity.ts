/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, nothing } from 'lit';
import { consume } from '@lit/context';
import { customElement, property } from 'lit/decorators.js';

import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';

import type { LogIdentityItem } from '../features/app/logIdentity.js';
import { globalStyles } from '../styles/global.styles.js';
import { headerItemStyles } from '../styles/headerItem.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

/**
 * One header identity item (entry point, user, or start time). Same muted idiom
 * as `log-meta`; the compact label is capped via `cap`, with the full value in
 * the tooltip. Renders a skeleton while `item` is null; the host decides whether
 * to render the element at all when the item is known to be absent.
 */
@customElement('log-identity')
export class LogIdentity extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

  @property({ attribute: false })
  item: LogIdentityItem | null = null;

  /** Cap on the compact label as a CSS length, e.g. '24ch'. Empty means uncapped. */
  @property()
  cap = '';

  /** Skeleton width while loading, e.g. '12ch'. */
  @property()
  skeletonWidth = '8ch';

  static styles = [
    globalStyles,
    skeletonStyles,
    headerItemStyles,
    css`
      /* The host's cap bounds the label; the tooltip carries the full value. */
      .item {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .item.skeleton {
        height: 80%;
      }
    `,
  ];

  render() {
    if (this.item === null) {
      return this.logStatus === 'parsing'
        ? html`<span class="item skeleton" style="width: ${this.skeletonWidth};"></span>`
        : nothing;
    }
    return html`<span
      class="item"
      style="${this.cap ? `max-width: ${this.cap};` : ''}"
      title="${this.item.detail}"
      >${this.item.label}</span
    >`;
  }
}
