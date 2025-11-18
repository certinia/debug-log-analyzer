/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Timeline Type Definitions
 *
 * Core types for PixiJS-based timeline visualization.
 * Based on contracts from specs/001-pixijs-timeline-v2/contracts/timeline-api.ts
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../core/log-parser/types.js';

// ============================================================================
// VIEWPORT STATE
// ============================================================================

/**
 * Viewport state representing camera position and zoom.
 * All coordinates are in pixels, timestamps in nanoseconds.
 */
export interface ViewportState {
  /** Zoom level (pixels per nanosecond). Higher = more zoomed in. */
  zoom: number;

  /** Horizontal scroll offset in pixels. */
  offsetX: number;

  /** Vertical scroll offset in pixels (for deep call stacks). */
  offsetY: number;

  /** Canvas width in pixels. */
  displayWidth: number;

  /** Canvas height in pixels. */
  displayHeight: number;
}

/**
 * Viewport bounds in timeline coordinates.
 * Used for culling and event lookup.
 */
export interface ViewportBounds {
  /** Leftmost visible timestamp (nanoseconds). */
  timeStart: number;

  /** Rightmost visible timestamp (nanoseconds). */
  timeEnd: number;

  /** Bottom-most visible depth level. */
  depthStart: number;

  /** Top-most visible depth level. */
  depthEnd: number;
}

// ============================================================================
// RENDERING STRUCTURES
// ============================================================================

/**
 * Render batch grouping events by category for GPU batching.
 */
export interface RenderBatch {
  /** Event category this batch represents. */
  category: LogSubCategory;

  /** PixiJS color value (0xRRGGBB). */
  color: number;

  /** Rectangles to render (only visible events). */
  rectangles: RenderRectangle[];

  /** Whether batch needs rebuilding. */
  isDirty: boolean;
}

/**
 * Minimal rectangle data for GPU rendering.
 */
export interface RenderRectangle {
  /** X position in pixels (timeline coordinate space). */
  x: number;

  /** Y position in pixels (depth * EVENT_HEIGHT). */
  y: number;

  /** Width in pixels. */
  width: number;

  /** Height in pixels (constant EVENT_HEIGHT). */
  height: number;

  /** Reference to source event (for tooltips/click handling). */
  eventRef: LogEvent;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Timeline state container for entire component.
 */
export interface TimelineState {
  /** Input event data. */
  events: LogEvent[];

  /** Viewport state. */
  viewport: ViewportState;

  /** Render batches (7 categories). */
  batches: Map<LogSubCategory, RenderBatch>;

  /** Interaction state. */
  interaction: {
    isDragging: boolean;
    lastMousePos: { x: number; y: number };
    hoveredEvent: LogEvent | null;
  };

  /** Flags. */
  needsRender: boolean;
  isInitialized: boolean;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Map of event categories to colors.
 * Colors can be hex strings ("#RRGGBB"), CSS color names, or rgb/rgba strings.
 */
export type TimelineColorMap = {
  [K in LogSubCategory]?: string;
};

/**
 * Configuration options for timeline initialization.
 */
export interface TimelineOptions {
  /** Custom colors for event categories. */
  colors?: TimelineColorMap;

  /** Event handlers for user interactions. */
  onEventClick?: (event: LogEvent) => void;
  onEventHover?: (event: LogEvent | null) => void;
  onViewportChange?: (viewport: ViewportState) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Timeline rendering constants.
 * Using UPPER_CASE naming for constants (standard convention).
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const TIMELINE_CONSTANTS = {
  /** Height of each event rectangle in pixels. */
  EVENT_HEIGHT: 15,

  /** Minimum rectangle width in pixels before culling. */
  MIN_RECT_SIZE: 0.5,

  /** Gap between rectangles in pixels (negative space separation). */
  RECT_GAP: 1,

  /** Default color map (matches current Canvas2D colors). */
  DEFAULT_COLORS: {
    'Code Unit': '#88AE58',
    Workflow: '#51A16E',
    Method: '#2B8F81',
    Flow: '#337986',
    DML: '#285663',
    SOQL: '#5D4963',
    'System Method': '#5C3444',
  } as TimelineColorMap,

  /** Maximum zoom level (0.01ms = 10 microsecond visible width in nanoseconds). */
  MAX_ZOOM_NS: 10_000,

  /** Target performance thresholds. */
  PERFORMANCE_TARGETS: {
    INITIAL_RENDER_MS: 2000,
    MIN_FPS: 30,
    TOOLTIP_DELAY_MS: 100,
    RESIZE_DELAY_MS: 200,
  },
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Timeline-specific error types.
 */
export enum TimelineErrorCode {
  WEBGL_UNAVAILABLE = 'WEBGL_UNAVAILABLE',
  INVALID_CONTAINER = 'INVALID_CONTAINER',
  INVALID_EVENT_DATA = 'INVALID_EVENT_DATA',
  RENDER_FAILED = 'RENDER_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Custom error class for timeline-specific errors.
 */
export class TimelineError extends Error {
  constructor(
    public code: TimelineErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'TimelineError';
  }
}

// ============================================================================
// TIMELINE MARKER VISUALIZATION
// ============================================================================

/**
 * Marker type enumeration.
 * Represents the three states of log Marker in Salesforce debug logs.
 * Order represents severity for stacking: error > unexpected > skip
 */
export type MarkerType = 'error' | 'skip' | 'unexpected';

/**
 * Represents a time range in the log where Marker occurred.
 * Extracted from ApexLog.logIssues during timeline initialization.
 */
export interface TimelineMarker {
  /**
   * Type of marker
   * - 'error': Critical system error causing marker (highest severity)
   * - 'skip': Intentional content omission (e.g., "*** Skipped 500 lines")
   * - 'unexpected': Anomalous marker (e.g., incomplete log entry)
   */
  type: MarkerType;

  /**
   */
  summary: string;

  /**
   * Time position (in nanoseconds) where marker began.
   * Must be >= 0. Maps to the timestamp when the marker marker was
   * encountered in the log file.
   */
  startTime: number;

  /**
   * Optional additional context about the marker.
   * May include error messages, reason codes, line numbers, or other diagnostic info.
   */
  metadata?: string;
}

/**
 * Type guard to check if a string is a valid markerType.
 */
export function isMarkerType(value: string): value is MarkerType {
  return value === 'error' || value === 'skip' || value === 'unexpected';
}

/**
 * Color mapping for marker types.
 * Values are PixiJS numeric color codes (0xRRGGBB format).
 * Alpha channel (0.2) applied separately during rendering via MARKER_ALPHA.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const MARKER_COLORS: Record<MarkerType, number> = {
  error: 0xff8080, // rgba(255, 128, 128, 0.2) - light red
  skip: 0x1e80ff, // rgba(30, 128, 255, 0.2) - light blue
  unexpected: 0x8080ff, // rgba(128, 128, 255, 0.2) - light purple
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Transparency level for all truncation indicators.
 * Applied uniformly to ensure indicators remain in background.
 */
export const MARKER_ALPHA = 0.2;

/**
 * Severity levels in ascending order (lowest to highest).
 * Used for z-index stacking when indicators overlap.
 * Render order: unexpected first (bottom layer) → unexpected → error (top layer).
 */
export const SEVERITY_ORDER: readonly MarkerType[] = ['unexpected', 'skip', 'error'] as const;

/**
 * Maps truncation type to severity rank (higher = more severe).
 * Used for sorting and prioritization logic during hit testing.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const SEVERITY_RANK: Record<MarkerType, number> = {
  skip: 1,
  unexpected: 2,
  error: 3,
} as const;
/* eslint-enable @typescript-eslint/naming-convention */
