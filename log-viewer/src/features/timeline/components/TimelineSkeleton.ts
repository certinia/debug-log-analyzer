import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { skeletonStyles } from '../../../styles/skeleton.styles.js';

@customElement('timeline-skeleton')
export class TimelineSkeleton extends LitElement {
  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        height: 100%;
        width: 100%;
        min-height: 0%;
        min-width: 0%;
        flex: 1;
        bottom: 0px;
      }

      .skeleton-text {
        width: 100%;
        height: 1.5rem;
        margin-bottom: 0.5rem;
        border-radius: 0.25rem;
      }

      .skeleton-inline {
        position: absolute;
        display: flex;
        gap: 10px;
      }
    `,
  ];

  render() {
    return html`
      <div class="skeleton-inline" style="width: 8%; bottom: 8rem; left: 15%;">
        <div class="skeleton skeleton-text" style="width: 80%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 20%; bottom: 6rem; left: 13%;">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 45%; bottom: 4rem; left: 10%;">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 30%; bottom: 4rem; left: 65%;">
        <div class="skeleton skeleton-text" style="width: 10%;"></div>
        <div class="skeleton skeleton-text" style="width: 30%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 90%; bottom: 2rem; left: 5%">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>
      <div class="skeleton skeleton-text skeleton-inline" style="width: 100%; bottom:0;"></div>
    `;
  }
}
