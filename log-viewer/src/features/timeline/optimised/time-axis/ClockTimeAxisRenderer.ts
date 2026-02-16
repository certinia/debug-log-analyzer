/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { Container, Graphics, Text } from 'pixi.js';

import { formatWallClockTime } from '../../../../core/utility/Util.js';
import type { TickInterval, TickLabelResult, TimeAxisLabelStrategy } from './MeshAxisRenderer.js';

const NS_PER_MS = 1_000_000;

const STICKY_PADDING_X = 4;
const STICKY_PADDING_Y = 2;
const STICKY_LEFT_X = 4;
const STICKY_TOP_Y = 5;

/**
 * Wall-clock time label strategy for the time axis.
 * Shows wall-clock time (HH:MM:SS.mmm) for anchor ticks and relative offsets
 * (+N ms) for sub-millisecond ticks between anchors.
 */
export class ClockTimeAxisRenderer implements TimeAxisLabelStrategy {
  private startTimeMs: number;
  private firstTimestampNs: number;
  private fontSize: number;

  /** Sticky label: persistent text pinned to left edge showing last off-screen anchor */
  private stickyText: Text | null = null;
  private stickyBackground: Graphics | null = null;

  /** Per-frame state */
  private previousWallClockMsInt = -1;
  private previousAnchorTime = 0;
  private lastOffscreenAnchorTime: number | null = null;
  private preComputedAnchorIdx = -1;
  private visibleLabels: { label: Text; isAnchor: boolean }[] = [];
  private textColor: string;

  constructor(startTimeMs: number, firstTimestampNs: number, fontSize: number, textColor: string) {
    this.startTimeMs = startTimeMs;
    this.firstTimestampNs = firstTimestampNs;
    this.fontSize = fontSize;
    this.textColor = textColor;
  }

  adjustTickInterval(interval: TickInterval): TickInterval {
    return { ...interval, skipFactor: 1 };
  }

  beginFrame(tickInterval: TickInterval, firstTickIndex: number, firstTimestampNs: number): void {
    this.previousWallClockMsInt = -1;
    this.previousAnchorTime = 0;
    this.lastOffscreenAnchorTime = null;
    this.preComputedAnchorIdx = -1;
    this.visibleLabels = [];

    // Pre-compute anchor state so the first tick in the loop is correctly
    // classified as wall-clock vs relative.
    const firstTime = firstTickIndex * tickInterval.interval;
    const firstMs = Math.round(this.startTimeMs + (firstTime - firstTimestampNs) / NS_PER_MS);

    // The ms boundary is where wallClockMs = firstMs - 0.5 (Math.round rounds .5 up).
    const msBoundaryNs = (firstMs - 0.5 - this.startTimeMs) * NS_PER_MS + firstTimestampNs;
    const anchorTickIndex = Math.ceil(msBoundaryNs / tickInterval.interval);

    this.previousWallClockMsInt = firstMs;
    this.previousAnchorTime = anchorTickIndex * tickInterval.interval;
    this.preComputedAnchorIdx = anchorTickIndex;

    if (anchorTickIndex < firstTickIndex) {
      this.lastOffscreenAnchorTime = this.previousAnchorTime;
    }
  }

  renderTickLabel(
    time: number,
    screenSpaceX: number,
    getOrCreateLabel: (text: string) => Text,
    tickIndex?: number,
  ): TickLabelResult | null {
    const wallClockMs = this.startTimeMs + (time - this.firstTimestampNs) / NS_PER_MS;
    const wallClockMsInt = Math.round(wallClockMs);

    let labelText: string;
    let isAnchorLabel = false;

    if (wallClockMsInt !== this.previousWallClockMsInt || tickIndex === this.preComputedAnchorIdx) {
      this.previousWallClockMsInt = wallClockMsInt;
      this.previousAnchorTime = time;
      labelText = formatWallClockTimeTrimmed(wallClockMs);
      isAnchorLabel = true;
    } else {
      labelText = formatRelativeOffset(time - this.previousAnchorTime);
    }

    if (!labelText) {
      return null;
    }

    const label = getOrCreateLabel(labelText);
    label.x = screenSpaceX - 3;
    label.y = 5;
    label.anchor.set(1, 0);

    if (isAnchorLabel) {
      const labelLeftEdge = label.x - estimateMonospaceWidth(labelText, this.fontSize);
      if (labelLeftEdge < 0) {
        this.lastOffscreenAnchorTime = time;
        label.visible = false;
      } else {
        this.visibleLabels.push({ label, isAnchor: true });
      }
    } else {
      this.visibleLabels.push({ label, isAnchor: false });
    }

    return { label, isAnchor: isAnchorLabel };
  }

  endFrame(screenSpaceContainer: Container | null, hasSubMsTicks: boolean): void {
    this.updateStickyLabel(
      this.lastOffscreenAnchorTime,
      this.visibleLabels,
      hasSubMsTicks,
      screenSpaceContainer,
    );
  }

  refreshColors(textColor: string): void {
    this.textColor = textColor;
    if (this.stickyText) {
      this.stickyText.style.fill = textColor;
    }
    this.updateStickyBackground();
  }

  destroy(): void {
    if (this.stickyText) {
      this.stickyText.destroy();
      this.stickyText = null;
    }
    if (this.stickyBackground) {
      this.stickyBackground.destroy();
      this.stickyBackground = null;
    }
  }

  // ============================================================================
  // PRIVATE: STICKY LABEL
  // ============================================================================

  private updateStickyLabel(
    lastOffscreenAnchorTime: number | null,
    visibleLabels: { label: Text; isAnchor: boolean }[],
    hasSubMsTicks: boolean,
    screenSpaceContainer: Container | null,
  ): void {
    if (!lastOffscreenAnchorTime || !screenSpaceContainer || !hasSubMsTicks) {
      this.hideStickyLabel();
      return;
    }

    const stickyTimeText = formatWallClockTimeTrimmed(
      this.startTimeMs + (lastOffscreenAnchorTime - this.firstTimestampNs) / NS_PER_MS,
    );

    if (!this.stickyText) {
      this.stickyText = new Text({
        text: stickyTimeText,
        style: {
          fontFamily: 'monospace',
          fontSize: this.fontSize,
          fill: this.textColor,
        },
      });
      this.stickyText.anchor.set(0, 0);
      screenSpaceContainer.addChild(this.stickyText);
    } else {
      this.stickyText.text = stickyTimeText;
    }

    this.stickyText.x = STICKY_LEFT_X + STICKY_PADDING_X;
    this.stickyText.y = STICKY_TOP_Y;
    this.stickyText.visible = true;

    if (!this.stickyBackground) {
      this.stickyBackground = new Graphics();
      const textIndex = screenSpaceContainer.getChildIndex(this.stickyText);
      screenSpaceContainer.addChildAt(this.stickyBackground, textIndex);
    }
    this.updateStickyBackground();
    this.stickyBackground.visible = true;

    const stickyRightEdge = STICKY_LEFT_X + this.stickyText.width + STICKY_PADDING_X * 2 + 4;

    for (const { label, isAnchor } of visibleLabels) {
      const labelLeftEdge = label.x - label.width;
      if (labelLeftEdge < stickyRightEdge) {
        if (isAnchor) {
          this.hideStickyLabel();
          break;
        }
        label.visible = false;
      }
    }
  }

  private updateStickyBackground(): void {
    if (!this.stickyBackground || !this.stickyText || !this.stickyText.visible) {
      return;
    }

    this.stickyBackground.clear();

    const bgColor = getStickyBackgroundColor();
    const width = this.stickyText.width + STICKY_PADDING_X * 2;
    const height = this.stickyText.height + STICKY_PADDING_Y * 2;

    this.stickyBackground.roundRect(
      STICKY_LEFT_X,
      STICKY_TOP_Y - STICKY_PADDING_Y,
      width,
      height,
      2,
    );
    this.stickyBackground.fill({ color: bgColor, alpha: 0.85 });
  }

  private hideStickyLabel(): void {
    if (this.stickyText) {
      this.stickyText.visible = false;
    }
    if (this.stickyBackground) {
      this.stickyBackground.visible = false;
    }
  }
}

// ============================================================================
// PRIVATE: FORMATTING UTILITIES
// ============================================================================

function formatWallClockTimeTrimmed(ms: number): string {
  const raw = formatWallClockTime(ms);
  return raw.replace(/\.?0+$/, '');
}

function formatRelativeOffset(offsetNs: number): string {
  if (offsetNs === 0) {
    return '';
  }

  const offsetMs = offsetNs / NS_PER_MS;

  if (offsetMs >= 1000) {
    const seconds = offsetMs / 1000;
    const formatted = seconds.toFixed(3).replace(/\.?0+$/, '');
    return `+${formatted} s`;
  }

  const formatted = offsetMs.toFixed(3).replace(/\.?0+$/, '');
  return `+${formatted} ms`;
}

function estimateMonospaceWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

function getStickyBackgroundColor(): number {
  const computedStyle = getComputedStyle(document.documentElement);
  const bgStr = computedStyle.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
  return parseColorToHex(bgStr);
}

function parseColorToHex(cssColor: string): number {
  if (!cssColor) {
    return 0x808080;
  }

  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1);
    if (hex.length === 6) {
      return parseInt(hex, 16);
    }
    if (hex.length === 3) {
      const r = hex[0]!;
      const g = hex[1]!;
      const b = hex[2]!;
      return parseInt(r + r + g + g + b + b, 16);
    }
  }

  const rgba = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (rgba) {
    const r = parseInt(rgba[1]!, 10);
    const g = parseInt(rgba[2]!, 10);
    const b = parseInt(rgba[3]!, 10);
    return (r << 16) | (g << 8) | b;
  }

  return 0x808080;
}
