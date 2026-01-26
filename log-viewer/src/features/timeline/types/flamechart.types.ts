/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Timeline Type Definitions
 *
 * Core types for PixiJS-based timeline visualization.
 * Based on contracts from specs/001-pixijs-timeline-v2/contracts/timeline-api.ts
 */

//TODO: Remove deps outside timeline

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../core/log-parser/types.js';
import type { PrecomputedRect } from '../optimised/RectangleManager.js';

// Re-export LogEvent for use within timeline/optimised folder
// This keeps the log-parser dependency at the boundary (types file)
export type { LogEvent };

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

/**
 * Modifier keys state from mouse/keyboard events.
 * Used for Cmd/Ctrl+Click navigation.
 */
export interface ModifierKeys {
  /** Meta key (Cmd on Mac). */
  metaKey: boolean;

  /** Ctrl key. */
  ctrlKey: boolean;

  /** Shift key. */
  shiftKey: boolean;

  /** Alt/Option key. */
  altKey: boolean;
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

  /** PixiJS color value (0xRRGGBB) - pre-blended opaque. */
  color: number;

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

  /** Cached batch colors for bucket color resolution (performance optimization). */
  batchColorsCache: Map<string, { color: number }>;

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

  /**
   * Renderer type: 'sprite' or 'mesh'.
   * - 'sprite': Uses SpritePool with shared texture (proven approach)
   * - 'mesh': Uses custom mesh with vertex colors (potentially faster for large datasets)
   * Default: 'mesh' for testing, can be changed to 'sprite' for comparison.
   */
  renderer?: 'sprite' | 'mesh';

  /** Event handlers for user interactions. */
  onEventClick?: (event: LogEvent) => void;
  onEventHover?: (event: LogEvent | null) => void;
  onViewportChange?: (viewport: ViewportState) => void;
}

// ============================================================================
// SUB-PIXEL BUCKET TYPES
// ============================================================================

/**
 * Aggregated statistics for a single category within a bucket.
 */
export interface CategoryAggregation {
  /** Number of events of this category */
  count: number;
  /** Total duration in nanoseconds */
  totalDuration: number;
}

/**
 * Statistics per category for color resolution.
 */
export interface CategoryStats {
  /** Map of category name to aggregated stats */
  byCategory: Map<string, CategoryAggregation>;
  /** Winning category after priority/duration/count resolution */
  dominantCategory: string;
}

/**
 * A 2px-wide aggregation of sub-pixel events at a specific depth.
 */
export interface PixelBucket {
  /** Unique identifier: bucket-{depth}-{bucketIndex} */
  id: string;
  /** Screen X position (timeStart * zoom - offsetX) */
  x: number;
  /** Screen Y position (depth * EVENT_HEIGHT) */
  y: number;
  /** Start time in nanoseconds (time-aligned boundary) */
  timeStart: number;
  /** End time in nanoseconds */
  timeEnd: number;
  /** Call stack depth (0-indexed) */
  depth: number;
  /** Number of aggregated events */
  eventCount: number;
  /** Per-category statistics */
  categoryStats: CategoryStats;
  /** Source event references for tooltip/click */
  eventRefs: LogEvent[];
  /** Resolved display color (hex number) - pre-blended opaque color for rendering */
  color: number;
}

/**
 * Statistics about the current render pass.
 */
export interface RenderStats {
  /** Events rendered normally (> 2px) */
  visibleCount: number;
  /** Events aggregated into buckets (≤ 2px) */
  bucketedEventCount: number;
  /** Number of buckets created */
  bucketCount: number;
  /** Max events in any single bucket */
  maxEventsPerBucket: number;
}

/**
 * Return type from getCulledRectangles() with bucket support.
 */
export interface CulledRenderData {
  /** Events > 2px screen width - render normally, keyed by category */
  visibleRects: Map<string, PrecomputedRect[]>;
  /** Aggregated buckets for events ≤ 2px, keyed by category */
  buckets: Map<string, PixelBucket[]>;
  /** Render statistics */
  stats: RenderStats;
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

  /** Minimum rectangle width in pixels before culling (events below this go to buckets). */
  MIN_RECT_SIZE: 2,

  /** Gap between rectangles in pixels (negative space separation). */
  RECT_GAP: 1,

  /** Default color map (matches current Canvas2D colors). */
  DEFAULT_COLORS: {
    'Code Unit': '#88AE58',
    Workflow: '#51A16E',
    Method: '#2B8F81',
    Flow: '#5C8FA6',
    DML: '#B06868',
    SOQL: '#6D4C7D',
    'System Method': '#8D6E63',
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
// BUCKET RENDERING CONSTANTS
// ============================================================================

/**
 * Constants for sub-pixel bucket rendering (barcode pattern).
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const BUCKET_CONSTANTS = {
  /** Total bucket width in pixels (block + gap) */
  BUCKET_WIDTH: 2,

  /** Width of the rendered block within a bucket */
  BUCKET_BLOCK_WIDTH: 1,

  /** Gap after the block (implicit - just don't draw) */
  BUCKET_GAP_WIDTH: 1,

  /** Opacity settings for density visualization */
  OPACITY: {
    /** Minimum opacity for buckets with 1 event */
    MIN: 0.3,
    /** Maximum opacity for saturated buckets */
    MAX: 0.9,
    /** Opacity range (MAX - MIN) */
    RANGE: 0.6,
    /** Event count at which opacity saturates */
    SATURATION_COUNT: 100,
  },

  /**
   * Category priority order for bucket color resolution (highest priority first).
   * When multiple categories exist in a bucket, highest priority wins.
   * Tie-breakers: total duration → event count
   */
  CATEGORY_PRIORITY: [
    'DML',
    'SOQL',
    'Method',
    'Code Unit',
    'System Method',
    'Flow',
    'Workflow',
  ] as const,
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Type for category names in priority order.
 */
export type BucketCategoryPriority = (typeof BUCKET_CONSTANTS.CATEGORY_PRIORITY)[number];

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
   * Unique identifier for this marker.
   * Used for selection tracking and navigation.
   */
  id: string;

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

// ============================================================================
// TEMPORAL SEGMENT TREE TYPES
// ============================================================================

/**
 * Node in the temporal segment tree.
 *
 * Leaf nodes represent individual events; branch nodes aggregate children.
 * The tree is used for O(log n) viewport culling and bucket aggregation,
 * replacing the per-frame O(n) iteration in RectangleManager.
 *
 * Key optimization: Pre-computed category stats enable instant bucket
 * rendering without recalculating aggregates per frame.
 */
export interface SegmentNode {
  // Time bounds (nanoseconds)
  /** Start time of this node's span (nanoseconds) */
  timeStart: number;
  /** End time of this node's span (nanoseconds) */
  timeEnd: number;

  /** Time span = timeEnd - timeStart (nanoseconds) */
  nodeSpan: number;

  // Category statistics (for tooltips and color resolution)
  /** Per-category event counts and durations */
  categoryStats: Map<string, CategoryAggregation>;
  /** Winning category after priority/duration/count resolution */
  dominantCategory: string;
  /** Pre-computed priority for dominantCategory (avoids map lookup during query) */
  dominantPriority: number;

  // Event tracking
  /** Total event count in this subtree */
  eventCount: number;
  /** For leaf nodes only: reference to source event */
  eventRef?: LogEvent;
  /** For leaf nodes only: direct reference to PrecomputedRect (avoids O(n) lookup) */
  rectRef?: PrecomputedRect;

  // Tree structure
  /** Child nodes (null for leaf nodes) */
  children: SegmentNode[] | null;
  /** Whether this is a leaf node */
  isLeaf: boolean;

  // Y position (pre-computed based on depth)
  /** Screen Y position = depth * EVENT_HEIGHT */
  y: number;
  /** Call stack depth (0-indexed) */
  depth: number;
}

/**
 * Result from segment tree query.
 * Same shape as CulledRenderData for easy integration.
 */
export interface SegmentTreeQueryResult {
  /** Events > threshold screen width - render as rectangles */
  visibleRects: Map<string, PrecomputedRect[]>;
  /** Aggregated nodes for events <= threshold - render as buckets, keyed by category */
  buckets: Map<string, PixelBucket[]>;
  /** Render statistics */
  stats: RenderStats;
}

/**
 * Constants for segment tree construction and traversal.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const SEGMENT_TREE_CONSTANTS = {
  /**
   * Branching factor for tree construction.
   * 4 provides a good balance between tree height (log4(n) levels)
   * and cache efficiency (4 children fit in a cache line).
   */
  BRANCHING_FACTOR: 4,

  /**
   * Minimum node span (nanoseconds) to avoid degenerate trees.
   * Events shorter than this are treated as having this duration.
   */
  MIN_NODE_SPAN: 1,
} as const;
/* eslint-enable @typescript-eslint/naming-convention */
