/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Timeline Type Definitions
 *
 * Core types for PixiJS-based timeline visualization.
 * Based on contracts from specs/001-pixijs-timeline-v2/contracts/timeline-api.ts
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../core/log-parser/types.js';
import type { PrecomputedRect } from '../optimised/RectangleManager.js';

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
// GENERIC EVENT TYPES
// ============================================================================

/**
 * Generic event interface for timeline visualization.
 * Provides minimal properties needed for rendering and search,
 * decoupled from specific log parser implementations.
 */
export interface EventNode {
  /** Unique identifier for this event */
  id: string;

  /** Start time in nanoseconds */
  timestamp: number;

  /** Duration in nanoseconds */
  duration: number;

  /** Event type (e.g., 'METHOD_ENTRY', 'SOQL_EXECUTE') */
  type: string;

  /** Display text for event */
  text: string;
}

/**
 * Tree node wrapper for hierarchical event structures.
 * Enables generic tree traversal without assuming specific
 * event hierarchy implementation (e.g., event.children).
 */
export interface TreeNode<T extends EventNode> {
  /** Event data */
  data: T;

  /** Child nodes (optional for leaf nodes) */
  children?: TreeNode<T>[];

  /** Depth in tree (0-indexed, optional for automatic calculation) */
  depth?: number;
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

  /** Alpha transparency (0-1). */
  alpha?: number;

  /** Rectangles to render (only visible events). */
  rectangles: PrecomputedRect[];

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

  /** Enable search functionality (default: false). */
  enableSearch?: boolean;

  /** Search configuration options. */
  searchConfig?: {
    /** Debounce delay for search in milliseconds (default: 300). */
    debounceMs?: number;
    /** Enable case-sensitive search (default: false). */
    caseSensitive?: boolean;
  };

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

// ============================================================================
// TEXT LABEL CONSTANTS
// ============================================================================

/**
 * Constants for text label rendering on timeline rectangles.
 * Used by TextLabelRenderer for LOD-based visibility and truncation.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const TEXT_LABEL_CONSTANTS = {
  /** Minimum rectangle width (px) to display any text */
  MIN_VISIBLE_WIDTH: 12,

  /** Approximate character width in pixels for truncation calculation (at 10px monospace font) */
  CHAR_WIDTH: 6,

  /** Left padding inside rectangle (px) - visual indent from left edge */
  PADDING_LEFT: 4,

  /** Right padding inside rectangle (px) - visual indent from right edge */
  PADDING_RIGHT: 4,

  /** Ellipsis character for truncation */
  ELLIPSIS: '…',

  /** Minimum characters required to show text (1 char + ellipsis = 2) */
  MIN_CHARS_WITH_ELLIPSIS: 1,

  /** Z-index for text container (above rectangles) */
  Z_INDEX: 10,

  /** Font configuration */
  FONT: {
    /** Font family name for BitmapText */
    FAMILY: 'timeline-mono',
    /** Font size in pixels */
    SIZE: 10,
    /** Text color (white for contrast on all category colors) */
    // COLOR: 0xffffff,
    // COLOR: 0xd7d7d7,
    // COLOR: 0x333333,
    // COLOR: 0x000000,
    DARK_THEME_COLOR: 0xe3e3e3,
    LIGHT_THEME_COLOR: 0x1e1e1e,
  },
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

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

// ============================================================================
// SEARCH & HIGHLIGHT
// ============================================================================

/**
 * Represents a single event that matches search criteria.
 * Cache structure to avoid re-searching during navigation.
 */
export interface SearchMatch {
  /** Reference to the matching LogEvent. */
  event: LogEvent;

  /** Pre-computed rendering rectangle for this event. */
  rect: PrecomputedRect;

  /** Depth of event in call tree (0-indexed). */
  depth: number;

  /** Which field contained the match ('type' or 'text'). */
  matchType: 'type' | 'text';
}

/**
 * Search behavior options.
 */
export interface SearchOptions {
  /** Case-sensitive matching. */
  matchCase: boolean;
}

/**
 * Payload for find/search CustomEvents (lv-find, lv-find-match, lv-find-close).
 * Standardized communication between FindWidget and Timeline components.
 */
export interface FindEventDetail {
  /** Search query text. */
  text: string;

  /**
   * Match index for navigation (1-based).
   * - For lv-find: Always 1 (start at first match)
   * - For lv-find-match: Current match number (1 to totalMatches)
   * - For lv-find-close: Always 0 (no active match)
   */
  count: number;

  /** Search options. */
  options: SearchOptions;
}

/**
 * Payload for find results CustomEvent (lv-find-results).
 * Timeline dispatches this after search completes.
 */
export interface FindResultsEventDetail {
  /** Total number of matches found. */
  totalMatches: number;
}
