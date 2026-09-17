import { consume } from '@lit/context';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logStatusContext, type LogStatus } from '../core/log/logStatus.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { skeletonStyles } from '../styles/skeleton.styles.js';

@customElement('grid-skeleton')
export class GridSkeleton extends LitElement {
  @consume({ context: logStatusContext, subscribe: true })
  @property({ attribute: false })
  logStatus: LogStatus = 'parsing';

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
      }

      .skeleton-text {
        width: 100%;
        height: 1rem;
        margin-bottom: 0.5rem;
      }

      .skeleton-wrapper {
        display: flex;
        position: relative;
        width: 100%;
        flex-direction: column;
        justify-content: center;
      }

      .skeleton-inline {
        display: flex;
        gap: 10px;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    // Decoration standing in for content: a reader is told the log is loading once,
    // by the app's own live region.
    this.setAttribute('aria-hidden', 'true');
  }

  render() {
    if (this.logStatus !== 'parsing') {
      return nothing;
    }
    return html`<div class="skeleton-wrapper">
      <div class="skeleton-inline" style="width: 100%; height: 1rem;"></div>
      <div class="skeleton-inline" style="width: 100%; bottom: 4rem;">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 100%; bottom: 2rem">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 100%; bottom: 0rem">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
      </div>
    </div>`;
  }
}
