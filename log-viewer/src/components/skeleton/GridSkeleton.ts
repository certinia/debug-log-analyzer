import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { globalStyles } from '../../styles/global.styles.js';
import { skeletonStyles } from './skeleton.styles.js';

@customElement('grid-skeleton')
export class GridSkeleton extends LitElement {
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
        border-radius: 0.25rem;
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

  render() {
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
