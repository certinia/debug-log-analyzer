/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { type TimelineGroup } from '../services/Timeline.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

@customElement('timeline-key')
export class Timelinekey extends LitElement {
  @property()
  timelineKeys: TimelineGroup[] = [];

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        margin-top: 5px;
      }
      .timeline-key__entry {
        display: inline-block;
        font-size: 0.9rem;
        padding: 4px;
        margin-right: 5px;
        font-family: monospace;
      }
    `,
  ];

  render() {
    const keyParts = [];
    for (const keyMeta of this.timelineKeys) {
      const textColor = this.getContrastingTextColor(keyMeta.fillColor);
      keyParts.push(
        html`<div
          class="timeline-key__entry"
          style="background-color:${keyMeta.fillColor}; color:${textColor}"
        >
          <span>${keyMeta.label}</span>
        </div>`,
      );
    }

    return keyParts;
  }

  /**
   * Calculate relative luminance of a hex color to determine if it's dark or light.
   * Supports #RGB, #RGBA, #RRGGBB, and #RRGGBBAA formats.
   * Uses WCAG formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
   */
  private getContrastingTextColor(hexColor: string): string {
    // Remove # if present
    let hex = hexColor.replace('#', '');

    // Normalize to 6-digit RGB format
    if (hex.length === 3) {
      // #RGB -> #RRGGBB
      hex = hex
        .split('')
        .map((char) => char + char)
        .join('');
    } else if (hex.length === 4) {
      // #RGBA -> #RRGGBB (ignore alpha)
      hex = hex
        .substring(0, 3)
        .split('')
        .map((char) => char + char)
        .join('');
    } else if (hex.length === 8) {
      // #RRGGBBAA -> #RRGGBB (ignore alpha)
      hex = hex.substring(0, 6);
    }

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Apply gamma correction for sRGB
    const rLin = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gLin = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bLin = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    // W3C relative luminance formula
    const luminance = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;

    // Use dark text for light backgrounds, light text for dark backgrounds
    // Threshold of 0.179 corresponds to ~50% perceived brightness
    return luminance > 0.179 ? '#1e1e1e' : '#e3e3e3';
  }
}
